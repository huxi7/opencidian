/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；期望值由 _analysis/obsidian-asar/app.css 逐条提取。
 * [OUTPUT]: 浅/深两套主题下设计变量的逐条对齐断言；失败时抛出差异清单，成功返回 pass 与断言数。
 * [POS]: scripts/acceptance 的永久主题地基场景。期望值内联在下方 EXPECT（来源行号见每项 line）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* 覆盖边界（按证据判定）：
 * 覆盖：body(app.css:2020-3059)/.theme-light(2866)/.theme-dark(2913)/.mod-macos(2970)/:root(2001-2019)
 *   中本应用实际消费的 340 项变量（每主题逐条断言 340 项，npm 结果的 checks 含以下追加断言）。
 *   追加断言：每主题 15 项（--shadow-edges/--shadow-xs 一致性、h1-h6 字号 px 解析、calc 令牌经真实属性解析、
 *   --canvas-color、--divider-vertical-height 类名分支）+ 主题装载 3 项 + 类名直切 2 项 + safe-area 消费 2 项。
 * 不覆盖·原版 PDF.js 内部变量（app.css 1443/1775/1791/1803/1810/1811-1815 的 --xfa-*、--csstools-*、
 *   --viewer-container-height、--page-margin、--page-border、--focus-ring-*、--loading-icon-delay、
 *   --spreadHorizontalWrapped-margin-LR）：本应用不含 PDF 阅读器（无非 pdfjs 依赖，src 无 pdfViewer/annotationLayer）。
 * 不覆盖·运行时内联值：--accent-h/s/l、--font-*-override、--font-text-size、--indent-size（app.js _applyTheme）、
 *   --zoom-factor（workspace-renderer 按 webFrame 缩放写入）。场景先断言默认主题色前提，再校验全部派生色。
 * 不覆盖·组件级同名变量：--pill-focus-width/left-adjust（markdown-properties.css）、--canvas-color（canvas-nodes.css）。
 *   场景在 body 级断言其最终值（--canvas-color），组件级规则不属于本文件的验收范围。
 * 照搬原版缺口：深色下原版未定义 --shadow-edges（app.css:2908 仅浅色定义），故 --shadow-xs 深色失效；
 *   场景断言两版一致地失效，而不是"修好"它。
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let count=0;const failures=[];
const check=(cond,msg)=>{count++;if(!cond)failures.push(msg);};
const norm=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const near=(a,b,tol)=>Math.abs(a-b)<=tol;

/* ---------------------------------------------------------------- 期望值（app.css 逐条提取） */
/* 每条格式：变量|app.css 原值|解析后期望值|类型|app.css 行号[|rgba]。
   由 _analysis/obsidian-asar/app.css 的 body(2020-3059)/.theme-light(2866)/.theme-dark(2913)/.mod-macos(2970) 块
   + :root(2001) 块按 CSS 变量替换规则解析得到（var() 递归替换、calc() 折叠、hsl() 转 sRGB）。 */
const EXPECT_TABLE={
light:[
  '--h1-weight|700|700|text|2012','--h2-weight|680|680|text|2013',
  '--h3-weight|660|660|text|2014','--h4-weight|640|640|text|2015',
  '--h5-weight|620|620|text|2016','--h6-weight|600|600|text|2017',
  '--blockquote-border-thickness|2px|2px|text|2087','--blockquote-border-color|var(--interactive-accent)|hsl(257, 88.88%, 70.95%)|color|2088|152,115,247,1',
  '--blockquote-font-style|normal|normal|text|2089','--blockquote-color|inherit||text|2090',
  '--blockquote-background-color|transparent|transparent|color|2091|0,0,0,0','--bold-color|inherit||text|2094',
  '--bold-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2095','--callout-border-width|0px|0px|text|2114',
  '--callout-border-opacity|0.25|0.25|text|2115','--callout-radius|var(--radius-s)|4px|text|2117',
  '--callout-blend-mode|var(--highlight-mix-blend-mode)|darken|text|2118','--callout-title-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2122',
  '--callout-bug|var(--color-red-rgb)|233, 49, 71|text|2125','--callout-default|var(--color-blue-rgb)|8, 109, 221|text|2126',
  '--callout-error|var(--color-red-rgb)|233, 49, 71|text|2127','--callout-example|var(--color-purple-rgb)|120, 82, 238|text|2128',
  '--callout-fail|var(--color-red-rgb)|233, 49, 71|text|2129','--callout-important|var(--color-cyan-rgb)|0, 191, 188|text|2130',
  '--callout-info|var(--color-blue-rgb)|8, 109, 221|text|2131','--callout-question|var(--color-orange-rgb)|236, 117, 0|text|2132',
  '--callout-success|var(--color-green-rgb)|8, 185, 78|text|2133','--callout-summary|var(--color-cyan-rgb)|0, 191, 188|text|2134',
  '--callout-tip|var(--color-cyan-rgb)|0, 191, 188|text|2135','--callout-todo|var(--color-blue-rgb)|8, 109, 221|text|2136',
  '--callout-warning|var(--color-orange-rgb)|236, 117, 0|text|2137','--callout-quote|158, 158, 158|158, 158, 158|text|2138',
  '--canvas-background|var(--background-primary)|#ffffff|color|2140|255,255,255,1','--canvas-card-label-color|var(--text-faint)|#ababab|color|2141|171,171,171,1',
  '--canvas-color-1|var(--color-red-rgb)|233, 49, 71|text|2142','--canvas-color-2|var(--color-orange-rgb)|236, 117, 0|text|2143',
  '--canvas-color-3|var(--color-yellow-rgb)|224, 172, 0|text|2144','--canvas-color-4|var(--color-green-rgb)|8, 185, 78|text|2145',
  '--canvas-color-5|var(--color-cyan-rgb)|0, 191, 188|text|2146','--canvas-color-6|var(--color-purple-rgb)|120, 82, 238|text|2147',
  '--canvas-dot-pattern|var(--color-base-30)|#e0e0e0|color|2151|224,224,224,1','--caret-color|var(--text-normal)|#222222|color|2153|34,34,34,1',
  '--checkbox-radius|var(--radius-s)|4px|text|2155','--checkbox-size|var(--font-text-size)|16px|text|2156',
  '--checkbox-marker-color|var(--background-primary)|#ffffff|color|2157|255,255,255,1','--checkbox-color|var(--interactive-accent)|hsl(257, 88.88%, 70.95%)|color|2158|152,115,247,1',
  '--checkbox-color-hover|var(--interactive-accent-hover)|hsl(255, 89.76%, 75.9%)|color|2159|166,138,249,1','--checkbox-border-color|var(--text-faint)|#ababab|color|2160|171,171,171,1',
  '--checkbox-border-color-hover|var(--text-muted)|#5c5c5c|color|2161|92,92,92,1','--code-white-space|pre-wrap|pre-wrap|text|2166',
  '--code-radius|var(--radius-s)|4px|text|2170','--code-size|var(--font-smaller)|0.875em|text|2171',
  '--code-background|var(--background-primary-alt)|#fafafa|color|2172|250,250,250,1','--code-normal|var(--text-normal)|#222222|color|2173|34,34,34,1',
  '--code-comment|var(--text-faint)|#ababab|color|2174|171,171,171,1','--code-function|var(--color-yellow)|#e0ac00|color|2175|224,172,0,1',
  '--code-important|var(--color-orange)|#ec7500|color|2176|236,117,0,1','--code-keyword|var(--color-pink)|#d53984|color|2177|213,57,132,1',
  '--code-operator|var(--color-red)|#e93147|color|2178|233,49,71,1','--code-property|var(--color-cyan)|#00bfbc|color|2179|0,191,188,1',
  '--code-punctuation|var(--text-muted)|#5c5c5c|color|2180|92,92,92,1','--code-string|var(--color-green)|#08b94e|color|2181|8,185,78,1',
  '--code-tag|var(--color-red)|#e93147|color|2182|233,49,71,1','--code-value|var(--color-purple)|#7852ee|color|2183|120,82,238,1',
  '--collapse-icon-color|var(--text-faint)|#ababab|color|2185|171,171,171,1','--collapse-icon-color-collapsed|var(--text-accent)|hsl(258, 88%, 66%)|color|2186|138,92,245,1',
  '--cursor|default|default|text|2188','--cursor-link|pointer|pointer|text|2189',
  '--divider-color|var(--background-modifier-border)|#e0e0e0|color|2195|224,224,224,1','--divider-color-hover|var(--interactive-accent)|hsl(257, 88.88%, 70.95%)|color|2196|152,115,247,1',
  '--divider-width|1px|1px|text|2197','--divider-width-hover|3px|3px|text|2198',
  '--embed-background|inherit||text|2215','--embed-border-start|2px solid var(--interactive-accent)|2px solid hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075))|text|2216',
  '--embed-padding|0 0 0 var(--size-4-6)|0 0 0 24px|text|2220','--embed-font-style|inherit||text|2221',
  '--file-line-width|700px|700px|text|2225','--file-folding-offset|24px|24px|text|2226',
  '--file-margins|var(--file-margins-y) var(--file-margins-x)|32px 32px|text|2227','--font-smallest|0.8em|0.8em|text|2239',
  '--font-smaller|0.875em|0.875em|text|2240','--font-small|0.933em|0.933em|text|2241',
  '--font-ui-smaller|12px|12px|text|2246','--font-ui-small|13px|13px|text|2247',
  '--font-ui-medium|15px|15px|text|2248','--font-ui-large|20px|20px|text|2249',
  '--font-weight|var(--font-normal)|400|text|2251','--font-thin|100|100|text|2252',
  '--font-extralight|200|200|text|2253','--font-light|300|300|text|2254',
  '--font-normal|400|400|text|2255','--font-medium|500|500|text|2256',
  '--font-semibold|600|600|text|2257','--font-bold|700|700|text|2258',
  '--font-extrabold|800|800|text|2259','--font-black|900|900|text|2260',
  '--graph-controls-width|240px|240px|text|2277','--graph-text|var(--text-normal)|#222222|color|2278|34,34,34,1',
  '--graph-line|var(--color-base-35, var(--background-modifier-border-focus))|#d4d4d4|color|2279|212,212,212,1','--graph-node|var(--text-muted)|#5c5c5c|color|2280|92,92,92,1',
  '--graph-node-unresolved|var(--text-faint)|#ababab|color|2281|171,171,171,1','--graph-node-focused|var(--text-accent)|hsl(258, 88%, 66%)|color|2282|138,92,245,1',
  '--graph-node-tag|var(--color-green)|#08b94e|color|2283|8,185,78,1','--graph-node-attachment|var(--color-yellow)|#e0ac00|color|2284|224,172,0,1',
  '--heading-spacing|calc(var(--p-spacing) * 2.5)|calc(1rem * 2.5)|text|2287','--h1-letter-spacing|-0.015em|-0.015em|text|2300',
  '--h2-letter-spacing|-0.011em|-0.011em|text|2301','--h3-letter-spacing|-0.008em|-0.008em|text|2302',
  '--h4-letter-spacing|-0.005em|-0.005em|text|2303','--h5-letter-spacing|-0.002em|-0.002em|text|2304',
  '--h6-letter-spacing|0em|0em|text|2305','--h1-line-height|1.2|1.2|text|2306',
  '--h2-line-height|1.2|1.2|text|2307','--h3-line-height|1.3|1.3|text|2308',
  '--h4-line-height|1.4|1.4|text|2309','--h5-line-height|var(--line-height-normal)|1.5|text|2310',
  '--h6-line-height|var(--line-height-normal)|1.5|text|2311','--h1-size|1.618em|1.618em|text|2312',
  '--h2-size|1.462em|1.462em|text|2313','--h3-size|1.318em|1.318em|text|2314',
  '--h4-size|1.188em|1.188em|text|2315','--h5-size|1.076em|1.076em|text|2316',
  '--h6-size|1em|1em|text|2317','--hr-color|var(--background-modifier-border)|#e0e0e0|color|2331|224,224,224,1',
  '--hr-thickness|2px|2px|text|2332','--icon-size|var(--icon-m)|16px|text|2334',
  '--icon-color|var(--text-muted)|#5c5c5c|color|2346|92,92,92,1','--icon-color-hover|var(--text-muted)|#5c5c5c|color|2347|92,92,92,1',
  '--icon-color-active|var(--text-accent)|hsl(258, 88%, 66%)|color|2348|138,92,245,1','--icon-opacity|0.85|0.85|text|2350',
  '--indentation-guide-width|var(--border-width)|1px|text|2358','--indentation-guide-color|rgba(var(--mono-rgb-100), 0.12)|rgba(0, 0, 0, 0.12)|color|2360|0,0,0,0.12',
  '--indentation-guide-color-active|rgba(var(--mono-rgb-100), 0.3)|rgba(0, 0, 0, 0.3)|color|2361|0,0,0,0.3','--inline-title-size|var(--h1-size)|1.618em|text|2369',
  '--inline-title-weight|var(--h1-weight)|700|text|2372','--input-height|30px|30px|text|2375',
  '--input-radius|5px|5px|text|2377','--input-border-width|var(--border-width)|1px|text|2380',
  '--input-placeholder-color|var(--text-faint)|#ababab|color|2382|171,171,171,1','--italic-color|inherit||text|2386',
  '--italic-weight|inherit||text|2387','--layer-popover|30|30|text|2392',
  '--layer-modal|50|50|text|2394','--layer-notice|60|60|text|2395',
  '--layer-menu|65|65|text|2396','--layer-tooltip|70|70|text|2397',
  '--line-height-normal|1.5|1.5|text|2400','--line-height-tight|1.3|1.3|text|2401',
  '--link-color|var(--text-accent)|hsl(258, 88%, 66%)|color|2403|138,92,245,1','--link-color-hover|var(--text-accent-hover)|hsl(255, 89.76%, 75.9%)|color|2404|166,138,249,1',
  '--link-decoration|underline|underline|text|2405','--link-decoration-hover|underline|underline|text|2406',
  '--link-decoration-thickness|auto|auto|text|2407','--link-weight|var(--font-weight)|400|text|2408',
  '--link-external-color|var(--text-accent)|hsl(258, 88%, 66%)|color|2409|138,92,245,1','--link-external-color-hover|var(--text-accent-hover)|hsl(255, 89.76%, 75.9%)|color|2410|166,138,249,1',
  '--link-external-decoration|underline|underline|text|2411','--link-external-decoration-hover|underline|underline|text|2412',
  '--link-external-filter|none|none|text|2413','--link-unresolved-color|var(--text-accent)|hsl(258, 88%, 66%)|color|2414|138,92,245,1',
  '--link-unresolved-opacity|0.7|0.7|text|2415','--link-unresolved-filter|none|none|text|2416',
  '--link-unresolved-decoration-style|solid|solid|text|2417','--link-unresolved-decoration-color|hsla(var(--interactive-accent-hsl), 0.3)|hsla(258, 88%, 66%, 0.3)|color|2418|138,92,245,0.3',
  '--list-indent|calc(var(--indent-unit) * var(--indent-size))|calc(0.5625em * 4)|text|2420','--list-marker-color|var(--text-faint)|#ababab|color|2424|171,171,171,1',
  '--list-marker-color-hover|var(--text-muted)|#5c5c5c|color|2425|92,92,92,1','--nav-item-size|var(--font-ui-small)|13px|text|2434',
  '--nav-item-color|var(--text-muted)|#5c5c5c|color|2436|92,92,92,1','--nav-item-color-hover|var(--text-normal)|#222222|color|2437|34,34,34,1',
  '--nav-item-color-active|var(--text-normal)|#222222|color|2438|34,34,34,1','--nav-item-background-hover|var(--background-modifier-hover)|rgba(0, 0, 0, 0.067)|color|2441|0,0,0,0.067',
  '--nav-item-background-selected|hsla(var(--color-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2443|138,92,245,0.15','--menu-background|var(--background-secondary)|#f6f6f6|color|2474|246,246,246,1',
  '--metadata-background|transparent|transparent|color|2480|0,0,0,0','--metadata-divider-color|var(--background-modifier-border)|#e0e0e0|color|2488|224,224,224,1',
  '--metadata-property-background-active|var(--background-modifier-hover)|rgba(0, 0, 0, 0.067)|color|2502|0,0,0,0.067','--metadata-label-text-color|var(--text-muted)|#5c5c5c|color|2511|92,92,92,1',
  '--metadata-input-text-color|var(--text-normal)|#222222|color|2515|34,34,34,1','--modal-background|var(--background-primary)|#ffffff|color|2526|255,255,255,1',
  '--modal-width|90vw|90vw|text|2527','--modal-max-width|1100px|1100px|text|2530',
  '--modal-border-width|var(--border-width)|1px|text|2534','--modal-border-color|var(--color-base-40, var(--background-modifier-border-focus))|#bdbdbd|color|2535|189,189,189,1',
  '--modal-radius|var(--radius-l)|12px|text|2536','--modal-community-sidebar-width|280px|280px|text|2537',
  '--pill-color|var(--text-muted)|#5c5c5c|color|2539|92,92,92,1','--pill-background|transparent|transparent|color|2545|0,0,0,0',
  '--pill-border-color|var(--background-modifier-border)|#e0e0e0|color|2547|224,224,224,1','--pill-padding-x|0.65em|0.65em|text|2550',
  '--pill-radius|2em|2em|text|2552','--prompt-background|var(--background-primary)|#ffffff|color|2572|255,255,255,1',
  '--prompt-input-height|40px|40px|text|2574','--prompt-width|700px|700px|text|2575',
  '--prompt-max-width|80vw|80vw|text|2576','--prompt-border-width|var(--border-width)|1px|text|2578',
  '--prompt-border-color|var(--color-base-40, var(--background-modifier-border-focus))|#bdbdbd|color|2579|189,189,189,1','--ribbon-background|var(--background-secondary)|#f6f6f6|color|2596|246,246,246,1',
  '--ribbon-background-collapsed|var(--background-primary)|#ffffff|color|2597|255,255,255,1','--ribbon-width|44px|44px|text|2598',
  '--ribbon-padding|var(--size-4-2) var(--size-4-1) var(--size-4-3)|8px 4px 12px|text|2599','--scrollbar-width|12px|12px|text|2601',
  '--scrollbar-height|12px|12px|text|2602','--scrollbar-border-width|3px 3px 3px 2px|3px 3px 3px 2px|text|2603',
  '--scrollbar-radius|var(--radius-l)|12px|text|2604','--scrollbar-active-thumb-bg|rgba(var(--mono-rgb-100), 0.2)|rgba(0, 0, 0, 0.2)|color|2605|0,0,0,0.2',
  '--scrollbar-bg|rgba(var(--mono-rgb-100), 0.05)|rgba(0, 0, 0, 0.05)|color|2606|0,0,0,0.05','--scrollbar-thumb-bg|rgba(var(--mono-rgb-100), 0.1)|rgba(0, 0, 0, 0.1)|color|2607|0,0,0,0.1',
  '--status-bar-background|var(--background-secondary)|#f6f6f6|color|2658|246,246,246,1','--status-bar-border-color|var(--divider-color)|#e0e0e0|color|2659|224,224,224,1',
  '--status-bar-border-width|var(--border-width) 0 0 var(--border-width)|1px 0 0 1px|text|2660','--status-bar-font-size|var(--font-ui-smaller)|12px|text|2661',
  '--status-bar-text-color|var(--text-muted)|#5c5c5c|color|2662|92,92,92,1','--status-bar-position|fixed|fixed|text|2663',
  '--status-bar-radius|var(--radius-m) 0 0 0|8px 0 0 0|text|2664','--tab-background-active|var(--background-primary)|#ffffff|color|2684|255,255,255,1',
  '--tab-text-color|var(--text-faint)|#ababab|color|2685|171,171,171,1','--tab-text-color-active|var(--text-muted)|#5c5c5c|color|2686|92,92,92,1',
  '--tab-text-color-focused|var(--text-muted)|#5c5c5c|color|2687|92,92,92,1','--tab-text-color-focused-active|var(--text-muted)|#5c5c5c|color|2688|92,92,92,1',
  '--tab-text-color-focused-highlighted|var(--text-accent)|hsl(258, 88%, 66%)|color|2689|138,92,245,1','--tab-text-color-focused-active-current|var(--text-normal)|#222222|color|2690|34,34,34,1',
  '--tab-font-size|var(--font-ui-small)|13px|text|2691','--tab-font-weight|inherit||text|2692',
  '--tab-container-background|var(--background-secondary)|#f6f6f6|color|2693|246,246,246,1','--tab-divider-color|var(--background-modifier-border-hover)|#d4d4d4|color|2694|212,212,212,1',
  '--tab-outline-color|var(--divider-color)|#e0e0e0|color|2695|224,224,224,1','--tab-outline-width|1px|1px|text|2696',
  '--tab-curve|6px|6px|text|2697','--tab-radius|var(--radius-s)|4px|text|2698',
  '--tab-radius-active|6px 6px 0 0|6px 6px 0 0|text|2699','--tab-width|200px|200px|text|2700',
  '--tab-max-width|320px|320px|text|2701','--tab-switcher-background|var(--background-secondary)|#f6f6f6|color|2704|246,246,246,1',
  '--tab-stacked-pane-width|700px|700px|text|2710','--tab-stacked-header-width|var(--header-height)|40px|text|2711',
  '--tab-stacked-shadow|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|text|2717','--table-background|transparent|transparent|color|2719|0,0,0,0',
  '--table-border-color|var(--background-modifier-border)|#e0e0e0|color|2721|224,224,224,1','--table-header-background|var(--table-background)|transparent|color|2723|0,0,0,0',
  '--table-header-color|var(--text-normal)|#222222|color|2730|34,34,34,1','--table-row-background-hover|var(--table-background)|transparent|color|2739|0,0,0,0',
  '--tag-size|var(--font-smaller)|0.875em|text|2758','--tag-color|var(--text-accent)|hsl(258, 88%, 66%)|color|2759|138,92,245,1',
  '--tag-color-hover|var(--text-accent)|hsl(258, 88%, 66%)|color|2760|138,92,245,1','--tag-background|hsla(var(--interactive-accent-hsl), 0.1)|hsla(258, 88%, 66%, 0.1)|color|2763|138,92,245,0.1',
  '--tag-background-hover|hsla(var(--interactive-accent-hsl), 0.2)|hsla(258, 88%, 66%, 0.2)|color|2764|138,92,245,0.2','--tag-border-color|hsla(var(--interactive-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2765|138,92,245,0.15',
  '--tag-border-color-hover|hsla(var(--interactive-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2766|138,92,245,0.15','--tag-padding-x|0.65em|0.65em|text|2768',
  '--tag-radius|2em|2em|text|2770','--titlebar-background|var(--background-secondary)|#f6f6f6|color|2776|246,246,246,1',
  '--titlebar-background-focused|var(--background-secondary-alt)|#fcfcfc|color|2777|252,252,252,1','--titlebar-border-width|0px|0px|text|2778',
  '--titlebar-border-color|var(--background-modifier-border)|#e0e0e0|color|2779|224,224,224,1','--titlebar-text-color|var(--text-muted)|#5c5c5c|color|2780|92,92,92,1',
  '--titlebar-text-color-focused|var(--text-normal)|#222222|color|2781|34,34,34,1','--titlebar-text-weight|var(--font-bold)|700|text|2782',
  '--vault-profile-color|var(--text-normal)|#222222|color|2814|34,34,34,1','--vault-profile-color-hover|var(--vault-profile-color)|#222222|color|2815|34,34,34,1',
  '--workspace-background-translucent|rgba(var(--mono-rgb-0), 0.6)|rgba(255, 255, 255, 0.6)|color|2817|255,255,255,0.6','--accent-h|258|258|text|2820',
  '--accent-s|88%|88%|text|2821','--accent-l|66%|66%|text|2822',
  '--background-primary|var(--color-base-00)|#ffffff|color|2824|255,255,255,1','--background-primary-alt|var(--color-base-10)|#fafafa|color|2825|250,250,250,1',
  '--background-secondary|var(--color-base-20)|#f6f6f6|color|2826|246,246,246,1','--background-modifier-hover|rgba(var(--mono-rgb-100), 0.067)|rgba(0, 0, 0, 0.067)|color|2827|0,0,0,0.067',
  '--background-modifier-border|var(--color-base-30)|#e0e0e0|color|2829|224,224,224,1','--background-modifier-border-hover|var(--color-base-35)|#d4d4d4|color|2830|212,212,212,1',
  '--background-modifier-border-focus|var(--color-base-40)|#bdbdbd|color|2831|189,189,189,1','--background-modifier-error|var(--color-red)|#e93147|color|2833|233,49,71,1',
  '--background-modifier-success|var(--color-green)|#08b94e|color|2836|8,185,78,1','--background-modifier-message|rgba(0, 0, 0, 0.9)|rgba(0, 0, 0, 0.9)|color|2837|0,0,0,0.9',
  '--background-modifier-form-field|var(--color-base-00)|#ffffff|color|2839|255,255,255,1','--text-normal|var(--color-base-100)|#222222|color|2842|34,34,34,1',
  '--text-muted|var(--color-base-70)|#5c5c5c|color|2843|92,92,92,1','--text-faint|var(--color-base-50)|#ababab|color|2844|171,171,171,1',
  '--text-on-accent|white|white|color|2845|255,255,255,1','--text-error|var(--color-red)|#e93147|color|2847|233,49,71,1',
  '--text-warning|var(--color-orange)|#ec7500|color|2848|236,117,0,1','--text-success|var(--color-green)|#08b94e|color|2849|8,185,78,1',
  '--text-selection|hsla(var(--color-accent-hsl), 0.2)|hsla(258, 88%, 66%, 0.2)|color|2850|138,92,245,0.2','--text-highlight-bg|rgba(var(--text-highlight-bg-rgb), 0.4)|rgba(255, 208, 0, 0.4)|color|2852|255,208,0,0.4',
  '--text-accent|var(--color-accent)|hsl(258, 88%, 66%)|color|2853|138,92,245,1','--text-accent-hover|var(--color-accent-2)|hsl(255, 89.76%, 75.9%)|color|2854|166,138,249,1',
  '--interactive-normal|var(--color-base-00)|#ffffff|color|2855|255,255,255,1','--interactive-hover|var(--color-base-10)|#fafafa|color|2856|250,250,250,1',
  '--interactive-accent|var(--color-accent-1)|hsl(257, 88.88%, 70.95%)|color|2858|152,115,247,1','--interactive-accent-hover|var(--color-accent-2)|hsl(255, 89.76%, 75.9%)|color|2859|166,138,249,1',
  '--dropdown-background|var(--interactive-normal)|#ffffff|color|2863|255,255,255,1','--dropdown-background-hover|var(--interactive-hover)|#fafafa|color|2864|250,250,250,1',
  '--highlight-mix-blend-mode|darken|darken|text|2868','--mono-rgb-0|255, 255, 255|255, 255, 255|text|2869',
  '--mono-rgb-100|0, 0, 0|0, 0, 0|text|2870','--color-red-rgb|233, 49, 71|233, 49, 71|text|2871',
  '--color-red|#e93147|#e93147|color|2872|233,49,71,1','--color-orange-rgb|236, 117, 0|236, 117, 0|text|2873',
  '--color-orange|#ec7500|#ec7500|color|2874|236,117,0,1','--color-yellow-rgb|224, 172, 0|224, 172, 0|text|2875',
  '--color-yellow|#e0ac00|#e0ac00|color|2876|224,172,0,1','--color-green-rgb|8, 185, 78|8, 185, 78|text|2877',
  '--color-green|#08b94e|#08b94e|color|2878|8,185,78,1','--color-cyan-rgb|0, 191, 188|0, 191, 188|text|2879',
  '--color-cyan|#00bfbc|#00bfbc|color|2880|0,191,188,1','--color-blue-rgb|8, 109, 221|8, 109, 221|text|2881',
  '--color-blue|#086ddd|#086ddd|color|2882|8,109,221,1','--color-purple-rgb|120, 82, 238|120, 82, 238|text|2883',
  '--color-purple|#7852ee|#7852ee|color|2884|120,82,238,1','--color-pink-rgb|213, 57, 132|213, 57, 132|text|2885',
  '--color-pink|#d53984|#d53984|color|2886|213,57,132,1','--color-base-00|#ffffff|#ffffff|color|2887|255,255,255,1',
  '--color-base-05|#fcfcfc|#fcfcfc|color|2888|252,252,252,1','--color-base-10|#fafafa|#fafafa|color|2889|250,250,250,1',
  '--color-base-20|#f6f6f6|#f6f6f6|color|2890|246,246,246,1','--color-base-25|#e3e3e3|#e3e3e3|color|2891|227,227,227,1',
  '--color-base-30|#e0e0e0|#e0e0e0|color|2892|224,224,224,1','--color-base-35|#d4d4d4|#d4d4d4|color|2893|212,212,212,1',
  '--color-base-40|#bdbdbd|#bdbdbd|color|2894|189,189,189,1','--color-base-50|#ababab|#ababab|color|2895|171,171,171,1',
  '--color-base-60|#707070|#707070|color|2896|112,112,112,1','--color-base-70|#5c5c5c|#5c5c5c|color|2897|92,92,92,1',
  '--color-base-100|#222222|#222222|color|2898|34,34,34,1','--color-accent|hsl(var(--accent-h), var(--accent-s), var(--accent-l))|hsl(258, 88%, 66%)|color|2900|138,92,245,1',
  '--color-accent-1|hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))|hsl(257, 88.88%, 70.95%)|color|2901|152,115,247,1','--color-accent-2|hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15))|hsl(255, 89.76%, 75.9%)|color|2902|166,138,249,1',
  '--background-secondary-alt|var(--color-base-05)|#fcfcfc|color|2903|252,252,252,1','--background-modifier-cover|rgba(220, 220, 220, 0.4)|rgba(220, 220, 220, 0.4)|color|2905|220,220,220,0.4',
  '--input-shadow|inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 1.5px 0 rgba(0, 0, 0, 0.03), 0 1px 2px 0 rgba(0, 0, 0, 0.04), 0 0 0 0 transparent|inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 1.5px 0 rgba(0, 0, 0, 0.03), 0 1px 2px 0 rgba(0, 0, 0, 0.04), 0 0 0 0 transparent|text|2906','--input-shadow-hover|inset 0 0 0 1px rgba(0, 0, 0, 0.17), 0 2px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 1.5px 0 rgba(0, 0, 0, 0.03), 0 1px 2px 0 rgba(0, 0, 0, 0.04), 0 0 0 0 transparent|inset 0 0 0 1px rgba(0, 0, 0, 0.17), 0 2px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 1.5px 0 rgba(0, 0, 0, 0.03), 0 1px 2px 0 rgba(0, 0, 0, 0.04), 0 0 0 0 transparent|text|2907',
  '--shadow-s|0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07)|0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07)|text|2910','--shadow-l|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 15px 30px rgba(0, 0, 0, 0.1)|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 15px 30px rgba(0, 0, 0, 0.1)|text|2911',
  '--slider-thumb-width|30px|30px|text|2971','--toggle-width|44px|44px|text|2972',
  '--toggle-radius|24px|24px|text|2973','--toggle-thumb-height|16px|16px|text|2975',
  '--toggle-thumb-width|26px|26px|text|2976','--font-text-size|16px|16px|text|3055',
  '--zoom-factor|1|1|text|3959','--titlebar-height|30px|30px|text|3960',
].reduce((m,row)=>{const p=row.split('|');m[p[0]]={raw:p[1],value:p[2],kind:p[3],line:+p[4],rgba:p[5]?p[5].split(',').map(Number):undefined};return m;},{}),
dark:[
  '--h1-weight|700|700|text|2012','--h2-weight|680|680|text|2013',
  '--h3-weight|660|660|text|2014','--h4-weight|640|640|text|2015',
  '--h5-weight|620|620|text|2016','--h6-weight|600|600|text|2017',
  '--blockquote-border-thickness|2px|2px|text|2087','--blockquote-border-color|var(--interactive-accent)|hsl(258, 88%, 66%)|color|2088|138,92,245,1',
  '--blockquote-font-style|normal|normal|text|2089','--blockquote-color|inherit||text|2090',
  '--blockquote-background-color|transparent|transparent|color|2091|0,0,0,0','--bold-color|inherit||text|2094',
  '--bold-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2095','--callout-border-width|0px|0px|text|2114',
  '--callout-border-opacity|0.25|0.25|text|2115','--callout-radius|var(--radius-s)|4px|text|2117',
  '--callout-blend-mode|var(--highlight-mix-blend-mode)|lighten|text|2118','--callout-title-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2122',
  '--callout-bug|var(--color-red-rgb)|251, 70, 76|text|2125','--callout-default|var(--color-blue-rgb)|2, 122, 255|text|2126',
  '--callout-error|var(--color-red-rgb)|251, 70, 76|text|2127','--callout-example|var(--color-purple-rgb)|168, 130, 255|text|2128',
  '--callout-fail|var(--color-red-rgb)|251, 70, 76|text|2129','--callout-important|var(--color-cyan-rgb)|83, 223, 221|text|2130',
  '--callout-info|var(--color-blue-rgb)|2, 122, 255|text|2131','--callout-question|var(--color-orange-rgb)|233, 151, 63|text|2132',
  '--callout-success|var(--color-green-rgb)|68, 207, 110|text|2133','--callout-summary|var(--color-cyan-rgb)|83, 223, 221|text|2134',
  '--callout-tip|var(--color-cyan-rgb)|83, 223, 221|text|2135','--callout-todo|var(--color-blue-rgb)|2, 122, 255|text|2136',
  '--callout-warning|var(--color-orange-rgb)|233, 151, 63|text|2137','--callout-quote|158, 158, 158|158, 158, 158|text|2138',
  '--canvas-background|var(--background-primary)|#1e1e1e|color|2140|30,30,30,1','--canvas-card-label-color|var(--text-faint)|#666666|color|2141|102,102,102,1',
  '--canvas-color-1|var(--color-red-rgb)|251, 70, 76|text|2142','--canvas-color-2|var(--color-orange-rgb)|233, 151, 63|text|2143',
  '--canvas-color-3|var(--color-yellow-rgb)|224, 222, 113|text|2144','--canvas-color-4|var(--color-green-rgb)|68, 207, 110|text|2145',
  '--canvas-color-5|var(--color-cyan-rgb)|83, 223, 221|text|2146','--canvas-color-6|var(--color-purple-rgb)|168, 130, 255|text|2147',
  '--canvas-dot-pattern|var(--color-base-30)|#363636|color|2151|54,54,54,1','--caret-color|var(--text-normal)|#dadada|color|2153|218,218,218,1',
  '--checkbox-radius|var(--radius-s)|4px|text|2155','--checkbox-size|var(--font-text-size)|16px|text|2156',
  '--checkbox-marker-color|var(--background-primary)|#1e1e1e|color|2157|30,30,30,1','--checkbox-color|var(--interactive-accent)|hsl(258, 88%, 66%)|color|2158|138,92,245,1',
  '--checkbox-color-hover|var(--interactive-accent-hover)|hsl(255, 89.76%, 75.9%)|color|2159|166,138,249,1','--checkbox-border-color|var(--text-faint)|#666666|color|2160|102,102,102,1',
  '--checkbox-border-color-hover|var(--text-muted)|#b3b3b3|color|2161|179,179,179,1','--code-white-space|pre-wrap|pre-wrap|text|2166',
  '--code-radius|var(--radius-s)|4px|text|2170','--code-size|var(--font-smaller)|0.875em|text|2171',
  '--code-background|var(--background-primary-alt)|#242424|color|2172|36,36,36,1','--code-normal|var(--text-normal)|#dadada|color|2173|218,218,218,1',
  '--code-comment|var(--text-faint)|#666666|color|2174|102,102,102,1','--code-function|var(--color-yellow)|#e0de71|color|2175|224,222,113,1',
  '--code-important|var(--color-orange)|#e9973f|color|2176|233,151,63,1','--code-keyword|var(--color-pink)|#fa99cd|color|2177|250,153,205,1',
  '--code-operator|var(--color-red)|#fb464c|color|2178|251,70,76,1','--code-property|var(--color-cyan)|#53dfdd|color|2179|83,223,221,1',
  '--code-punctuation|var(--text-muted)|#b3b3b3|color|2180|179,179,179,1','--code-string|var(--color-green)|#44cf6e|color|2181|68,207,110,1',
  '--code-tag|var(--color-red)|#fb464c|color|2182|251,70,76,1','--code-value|var(--color-purple)|#a882ff|color|2183|168,130,255,1',
  '--collapse-icon-color|var(--text-faint)|#666666|color|2185|102,102,102,1','--collapse-icon-color-collapsed|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2186|166,138,249,1',
  '--cursor|default|default|text|2188','--cursor-link|pointer|pointer|text|2189',
  '--divider-color|var(--background-modifier-border)|#363636|color|2195|54,54,54,1','--divider-color-hover|var(--interactive-accent)|hsl(258, 88%, 66%)|color|2196|138,92,245,1',
  '--divider-width|1px|1px|text|2197','--divider-width-hover|3px|3px|text|2198',
  '--embed-background|inherit||text|2215','--embed-border-start|2px solid var(--interactive-accent)|2px solid hsl(258, 88%, 66%)|text|2216',
  '--embed-padding|0 0 0 var(--size-4-6)|0 0 0 24px|text|2220','--embed-font-style|inherit||text|2221',
  '--file-line-width|700px|700px|text|2225','--file-folding-offset|24px|24px|text|2226',
  '--file-margins|var(--file-margins-y) var(--file-margins-x)|32px 32px|text|2227','--font-smallest|0.8em|0.8em|text|2239',
  '--font-smaller|0.875em|0.875em|text|2240','--font-small|0.933em|0.933em|text|2241',
  '--font-ui-smaller|12px|12px|text|2246','--font-ui-small|13px|13px|text|2247',
  '--font-ui-medium|15px|15px|text|2248','--font-ui-large|20px|20px|text|2249',
  '--font-weight|var(--font-normal)|400|text|2251','--font-thin|100|100|text|2252',
  '--font-extralight|200|200|text|2253','--font-light|300|300|text|2254',
  '--font-normal|400|400|text|2255','--font-medium|500|500|text|2256',
  '--font-semibold|600|600|text|2257','--font-bold|700|700|text|2258',
  '--font-extrabold|800|800|text|2259','--font-black|900|900|text|2260',
  '--graph-controls-width|240px|240px|text|2277','--graph-text|var(--text-normal)|#dadada|color|2278|218,218,218,1',
  '--graph-line|var(--color-base-35, var(--background-modifier-border-focus))|#3f3f3f|color|2279|63,63,63,1','--graph-node|var(--text-muted)|#b3b3b3|color|2280|179,179,179,1',
  '--graph-node-unresolved|var(--text-faint)|#666666|color|2281|102,102,102,1','--graph-node-focused|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2282|166,138,249,1',
  '--graph-node-tag|var(--color-green)|#44cf6e|color|2283|68,207,110,1','--graph-node-attachment|var(--color-yellow)|#e0de71|color|2284|224,222,113,1',
  '--heading-spacing|calc(var(--p-spacing) * 2.5)|calc(1rem * 2.5)|text|2287','--h1-letter-spacing|-0.015em|-0.015em|text|2300',
  '--h2-letter-spacing|-0.011em|-0.011em|text|2301','--h3-letter-spacing|-0.008em|-0.008em|text|2302',
  '--h4-letter-spacing|-0.005em|-0.005em|text|2303','--h5-letter-spacing|-0.002em|-0.002em|text|2304',
  '--h6-letter-spacing|0em|0em|text|2305','--h1-line-height|1.2|1.2|text|2306',
  '--h2-line-height|1.2|1.2|text|2307','--h3-line-height|1.3|1.3|text|2308',
  '--h4-line-height|1.4|1.4|text|2309','--h5-line-height|var(--line-height-normal)|1.5|text|2310',
  '--h6-line-height|var(--line-height-normal)|1.5|text|2311','--h1-size|1.618em|1.618em|text|2312',
  '--h2-size|1.462em|1.462em|text|2313','--h3-size|1.318em|1.318em|text|2314',
  '--h4-size|1.188em|1.188em|text|2315','--h5-size|1.076em|1.076em|text|2316',
  '--h6-size|1em|1em|text|2317','--hr-color|var(--background-modifier-border)|#363636|color|2331|54,54,54,1',
  '--hr-thickness|2px|2px|text|2332','--icon-size|var(--icon-m)|16px|text|2334',
  '--icon-color|var(--text-muted)|#b3b3b3|color|2346|179,179,179,1','--icon-color-hover|var(--text-muted)|#b3b3b3|color|2347|179,179,179,1',
  '--icon-color-active|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2348|166,138,249,1','--icon-opacity|0.85|0.85|text|2350',
  '--indentation-guide-width|var(--border-width)|1px|text|2358','--indentation-guide-color|rgba(var(--mono-rgb-100), 0.12)|rgba(255, 255, 255, 0.12)|color|2360|255,255,255,0.12',
  '--indentation-guide-color-active|rgba(var(--mono-rgb-100), 0.3)|rgba(255, 255, 255, 0.3)|color|2361|255,255,255,0.3','--inline-title-size|var(--h1-size)|1.618em|text|2369',
  '--inline-title-weight|var(--h1-weight)|700|text|2372','--input-height|30px|30px|text|2375',
  '--input-radius|5px|5px|text|2377','--input-border-width|var(--border-width)|1px|text|2380',
  '--input-placeholder-color|var(--text-faint)|#666666|color|2382|102,102,102,1','--italic-color|inherit||text|2386',
  '--italic-weight|inherit||text|2387','--layer-popover|30|30|text|2392',
  '--layer-modal|50|50|text|2394','--layer-notice|60|60|text|2395',
  '--layer-menu|65|65|text|2396','--layer-tooltip|70|70|text|2397',
  '--line-height-normal|1.5|1.5|text|2400','--line-height-tight|1.3|1.3|text|2401',
  '--link-color|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2403|166,138,249,1','--link-color-hover|var(--text-accent-hover)|hsl(253, 92.4%, 85.14%)|color|2404|197,182,252,1',
  '--link-decoration|underline|underline|text|2405','--link-decoration-hover|underline|underline|text|2406',
  '--link-decoration-thickness|auto|auto|text|2407','--link-weight|var(--font-weight)|400|text|2408',
  '--link-external-color|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2409|166,138,249,1','--link-external-color-hover|var(--text-accent-hover)|hsl(253, 92.4%, 85.14%)|color|2410|197,182,252,1',
  '--link-external-decoration|underline|underline|text|2411','--link-external-decoration-hover|underline|underline|text|2412',
  '--link-external-filter|none|none|text|2413','--link-unresolved-color|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2414|166,138,249,1',
  '--link-unresolved-opacity|0.7|0.7|text|2415','--link-unresolved-filter|none|none|text|2416',
  '--link-unresolved-decoration-style|solid|solid|text|2417','--link-unresolved-decoration-color|hsla(var(--interactive-accent-hsl), 0.3)|hsla(258, 88%, 66%, 0.3)|color|2418|138,92,245,0.3',
  '--list-indent|calc(var(--indent-unit) * var(--indent-size))|calc(0.5625em * 4)|text|2420','--list-marker-color|var(--text-faint)|#666666|color|2424|102,102,102,1',
  '--list-marker-color-hover|var(--text-muted)|#b3b3b3|color|2425|179,179,179,1','--nav-item-size|var(--font-ui-small)|13px|text|2434',
  '--nav-item-color|var(--text-muted)|#b3b3b3|color|2436|179,179,179,1','--nav-item-color-hover|var(--text-normal)|#dadada|color|2437|218,218,218,1',
  '--nav-item-color-active|var(--text-normal)|#dadada|color|2438|218,218,218,1','--nav-item-background-hover|var(--background-modifier-hover)|rgba(255, 255, 255, 0.067)|color|2441|255,255,255,0.067',
  '--nav-item-background-selected|hsla(var(--color-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2443|138,92,245,0.15','--menu-background|var(--background-secondary)|#262626|color|2474|38,38,38,1',
  '--metadata-background|transparent|transparent|color|2480|0,0,0,0','--metadata-divider-color|var(--background-modifier-border)|#363636|color|2488|54,54,54,1',
  '--metadata-property-background-active|var(--background-modifier-hover)|rgba(255, 255, 255, 0.067)|color|2502|255,255,255,0.067','--metadata-label-text-color|var(--text-muted)|#b3b3b3|color|2511|179,179,179,1',
  '--metadata-input-text-color|var(--text-normal)|#dadada|color|2515|218,218,218,1','--modal-background|var(--background-primary)|#1e1e1e|color|2526|30,30,30,1',
  '--modal-width|90vw|90vw|text|2527','--modal-max-width|1100px|1100px|text|2530',
  '--modal-border-width|var(--border-width)|1px|text|2534','--modal-border-color|var(--color-base-40, var(--background-modifier-border-focus))|#555555|color|2535|85,85,85,1',
  '--modal-radius|var(--radius-l)|12px|text|2536','--modal-community-sidebar-width|280px|280px|text|2537',
  '--pill-color|var(--text-muted)|#b3b3b3|color|2539|179,179,179,1','--pill-background|transparent|transparent|color|2545|0,0,0,0',
  '--pill-border-color|var(--background-modifier-border)|#363636|color|2547|54,54,54,1','--pill-padding-x|0.65em|0.65em|text|2550',
  '--pill-radius|2em|2em|text|2552','--prompt-background|var(--background-primary)|#1e1e1e|color|2572|30,30,30,1',
  '--prompt-input-height|40px|40px|text|2574','--prompt-width|700px|700px|text|2575',
  '--prompt-max-width|80vw|80vw|text|2576','--prompt-border-width|var(--border-width)|1px|text|2578',
  '--prompt-border-color|var(--color-base-40, var(--background-modifier-border-focus))|#555555|color|2579|85,85,85,1','--ribbon-background|var(--background-secondary)|#262626|color|2596|38,38,38,1',
  '--ribbon-background-collapsed|var(--background-primary)|#1e1e1e|color|2597|30,30,30,1','--ribbon-width|44px|44px|text|2598',
  '--ribbon-padding|var(--size-4-2) var(--size-4-1) var(--size-4-3)|8px 4px 12px|text|2599','--scrollbar-width|12px|12px|text|2601',
  '--scrollbar-height|12px|12px|text|2602','--scrollbar-border-width|3px 3px 3px 2px|3px 3px 3px 2px|text|2603',
  '--scrollbar-radius|var(--radius-l)|12px|text|2604','--scrollbar-active-thumb-bg|rgba(var(--mono-rgb-100), 0.2)|rgba(255, 255, 255, 0.2)|color|2605|255,255,255,0.2',
  '--scrollbar-bg|rgba(var(--mono-rgb-100), 0.05)|rgba(255, 255, 255, 0.05)|color|2606|255,255,255,0.05','--scrollbar-thumb-bg|rgba(var(--mono-rgb-100), 0.1)|rgba(255, 255, 255, 0.1)|color|2607|255,255,255,0.1',
  '--status-bar-background|var(--background-secondary)|#262626|color|2658|38,38,38,1','--status-bar-border-color|var(--divider-color)|#363636|color|2659|54,54,54,1',
  '--status-bar-border-width|var(--border-width) 0 0 var(--border-width)|1px 0 0 1px|text|2660','--status-bar-font-size|var(--font-ui-smaller)|12px|text|2661',
  '--status-bar-text-color|var(--text-muted)|#b3b3b3|color|2662|179,179,179,1','--status-bar-position|fixed|fixed|text|2663',
  '--status-bar-radius|var(--radius-m) 0 0 0|8px 0 0 0|text|2664','--tab-background-active|var(--background-primary)|#1e1e1e|color|2684|30,30,30,1',
  '--tab-text-color|var(--text-faint)|#666666|color|2685|102,102,102,1','--tab-text-color-active|var(--text-muted)|#b3b3b3|color|2686|179,179,179,1',
  '--tab-text-color-focused|var(--text-muted)|#b3b3b3|color|2687|179,179,179,1','--tab-text-color-focused-active|var(--text-muted)|#b3b3b3|color|2688|179,179,179,1',
  '--tab-text-color-focused-highlighted|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2689|166,138,249,1','--tab-text-color-focused-active-current|var(--text-normal)|#dadada|color|2690|218,218,218,1',
  '--tab-font-size|var(--font-ui-small)|13px|text|2691','--tab-font-weight|inherit||text|2692',
  '--tab-container-background|var(--background-secondary)|#262626|color|2693|38,38,38,1','--tab-divider-color|var(--background-modifier-border-hover)|#3f3f3f|color|2694|63,63,63,1',
  '--tab-outline-color|var(--divider-color)|#363636|color|2695|54,54,54,1','--tab-outline-width|1px|1px|text|2696',
  '--tab-curve|6px|6px|text|2697','--tab-radius|var(--radius-s)|4px|text|2698',
  '--tab-radius-active|6px 6px 0 0|6px 6px 0 0|text|2699','--tab-width|200px|200px|text|2700',
  '--tab-max-width|320px|320px|text|2701','--tab-switcher-background|var(--background-secondary)|#262626|color|2704|38,38,38,1',
  '--tab-stacked-pane-width|700px|700px|text|2710','--tab-stacked-header-width|var(--header-height)|40px|text|2711',
  '--tab-stacked-shadow|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|text|2717','--table-background|transparent|transparent|color|2719|0,0,0,0',
  '--table-border-color|var(--background-modifier-border)|#363636|color|2721|54,54,54,1','--table-header-background|var(--table-background)|transparent|color|2723|0,0,0,0',
  '--table-header-color|var(--text-normal)|#dadada|color|2730|218,218,218,1','--table-row-background-hover|var(--table-background)|transparent|color|2739|0,0,0,0',
  '--tag-size|var(--font-smaller)|0.875em|text|2758','--tag-color|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2759|166,138,249,1',
  '--tag-color-hover|var(--text-accent)|hsl(255, 89.76%, 75.9%)|color|2760|166,138,249,1','--tag-background|hsla(var(--interactive-accent-hsl), 0.1)|hsla(258, 88%, 66%, 0.1)|color|2763|138,92,245,0.1',
  '--tag-background-hover|hsla(var(--interactive-accent-hsl), 0.2)|hsla(258, 88%, 66%, 0.2)|color|2764|138,92,245,0.2','--tag-border-color|hsla(var(--interactive-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2765|138,92,245,0.15',
  '--tag-border-color-hover|hsla(var(--interactive-accent-hsl), 0.15)|hsla(258, 88%, 66%, 0.15)|color|2766|138,92,245,0.15','--tag-padding-x|0.65em|0.65em|text|2768',
  '--tag-radius|2em|2em|text|2770','--titlebar-background|var(--background-secondary)|#262626|color|2776|38,38,38,1',
  '--titlebar-background-focused|var(--background-secondary-alt)|#363636|color|2777|54,54,54,1','--titlebar-border-width|0px|0px|text|2778',
  '--titlebar-border-color|var(--background-modifier-border)|#363636|color|2779|54,54,54,1','--titlebar-text-color|var(--text-muted)|#b3b3b3|color|2780|179,179,179,1',
  '--titlebar-text-color-focused|var(--text-normal)|#dadada|color|2781|218,218,218,1','--titlebar-text-weight|var(--font-bold)|700|text|2782',
  '--vault-profile-color|var(--text-normal)|#dadada|color|2814|218,218,218,1','--vault-profile-color-hover|var(--vault-profile-color)|#dadada|color|2815|218,218,218,1',
  '--workspace-background-translucent|rgba(var(--mono-rgb-0), 0.6)|rgba(0, 0, 0, 0.6)|color|2817|0,0,0,0.6','--accent-h|258|258|text|2820',
  '--accent-s|88%|88%|text|2821','--accent-l|66%|66%|text|2822',
  '--background-primary|var(--color-base-00)|#1e1e1e|color|2824|30,30,30,1','--background-primary-alt|var(--color-base-10)|#242424|color|2825|36,36,36,1',
  '--background-secondary|var(--color-base-20)|#262626|color|2826|38,38,38,1','--background-modifier-hover|rgba(var(--mono-rgb-100), 0.067)|rgba(255, 255, 255, 0.067)|color|2827|255,255,255,0.067',
  '--background-modifier-border|var(--color-base-30)|#363636|color|2829|54,54,54,1','--background-modifier-border-hover|var(--color-base-35)|#3f3f3f|color|2830|63,63,63,1',
  '--background-modifier-border-focus|var(--color-base-40)|#555555|color|2831|85,85,85,1','--background-modifier-error|var(--color-red)|#fb464c|color|2833|251,70,76,1',
  '--background-modifier-success|var(--color-green)|#44cf6e|color|2836|68,207,110,1','--background-modifier-message|rgba(0, 0, 0, 0.9)|rgba(0, 0, 0, 0.9)|color|2837|0,0,0,0.9',
  '--background-modifier-form-field|var(--color-base-25)|#2a2a2a|color|2951|42,42,42,1','--text-normal|var(--color-base-100)|#dadada|color|2842|218,218,218,1',
  '--text-muted|var(--color-base-70)|#b3b3b3|color|2843|179,179,179,1','--text-faint|var(--color-base-50)|#666666|color|2844|102,102,102,1',
  '--text-on-accent|white|white|color|2845|255,255,255,1','--text-error|var(--color-red)|#fb464c|color|2847|251,70,76,1',
  '--text-warning|var(--color-orange)|#e9973f|color|2848|233,151,63,1','--text-success|var(--color-green)|#44cf6e|color|2849|68,207,110,1',
  '--text-selection|hsla(var(--interactive-accent-hsl), 0.33)|hsla(258, 88%, 66%, 0.33)|color|2961|138,92,245,0.33','--text-highlight-bg|rgba(var(--text-highlight-bg-rgb), 0.4)|rgba(255, 208, 0, 0.4)|color|2852|255,208,0,0.4',
  '--text-accent|var(--color-accent-1)|hsl(255, 89.76%, 75.9%)|color|2955|166,138,249,1','--text-accent-hover|var(--color-accent-2)|hsl(253, 92.4%, 85.14%)|color|2854|197,182,252,1',
  '--interactive-normal|var(--color-base-30)|#363636|color|2953|54,54,54,1','--interactive-hover|var(--color-base-35)|#3f3f3f|color|2954|63,63,63,1',
  '--interactive-accent|var(--color-accent)|hsl(258, 88%, 66%)|color|2956|138,92,245,1','--interactive-accent-hover|var(--color-accent-1)|hsl(255, 89.76%, 75.9%)|color|2957|166,138,249,1',
  '--dropdown-background|var(--interactive-normal)|#363636|color|2863|54,54,54,1','--dropdown-background-hover|var(--interactive-hover)|#3f3f3f|color|2864|63,63,63,1',
  '--highlight-mix-blend-mode|lighten|lighten|text|2915','--mono-rgb-0|0, 0, 0|0, 0, 0|text|2916',
  '--mono-rgb-100|255, 255, 255|255, 255, 255|text|2917','--color-red-rgb|251, 70, 76|251, 70, 76|text|2918',
  '--color-red|#fb464c|#fb464c|color|2919|251,70,76,1','--color-orange-rgb|233, 151, 63|233, 151, 63|text|2920',
  '--color-orange|#e9973f|#e9973f|color|2921|233,151,63,1','--color-yellow-rgb|224, 222, 113|224, 222, 113|text|2922',
  '--color-yellow|#e0de71|#e0de71|color|2923|224,222,113,1','--color-green-rgb|68, 207, 110|68, 207, 110|text|2924',
  '--color-green|#44cf6e|#44cf6e|color|2925|68,207,110,1','--color-cyan-rgb|83, 223, 221|83, 223, 221|text|2926',
  '--color-cyan|#53dfdd|#53dfdd|color|2927|83,223,221,1','--color-blue-rgb|2, 122, 255|2, 122, 255|text|2928',
  '--color-blue|#027aff|#027aff|color|2929|2,122,255,1','--color-purple-rgb|168, 130, 255|168, 130, 255|text|2930',
  '--color-purple|#a882ff|#a882ff|color|2931|168,130,255,1','--color-pink-rgb|250, 153, 205|250, 153, 205|text|2932',
  '--color-pink|#fa99cd|#fa99cd|color|2933|250,153,205,1','--color-base-00|#1e1e1e|#1e1e1e|color|2934|30,30,30,1',
  '--color-base-05|#212121|#212121|color|2935|33,33,33,1','--color-base-10|#242424|#242424|color|2936|36,36,36,1',
  '--color-base-20|#262626|#262626|color|2937|38,38,38,1','--color-base-25|#2a2a2a|#2a2a2a|color|2938|42,42,42,1',
  '--color-base-30|#363636|#363636|color|2939|54,54,54,1','--color-base-35|#3f3f3f|#3f3f3f|color|2940|63,63,63,1',
  '--color-base-40|#555555|#555555|color|2941|85,85,85,1','--color-base-50|#666666|#666666|color|2942|102,102,102,1',
  '--color-base-60|#999999|#999999|color|2943|153,153,153,1','--color-base-70|#b3b3b3|#b3b3b3|color|2944|179,179,179,1',
  '--color-base-100|#dadada|#dadada|color|2945|218,218,218,1','--color-accent|hsl(var(--accent-h), var(--accent-s), var(--accent-l))|hsl(258, 88%, 66%)|color|2947|138,92,245,1',
  '--color-accent-1|hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15))|hsl(255, 89.76%, 75.9%)|color|2948|166,138,249,1','--color-accent-2|hsl(calc(var(--accent-h) - 5), calc(var(--accent-s) * 1.05), calc(var(--accent-l) * 1.29))|hsl(253, 92.4%, 85.14%)|color|2949|197,182,252,1',
  '--background-secondary-alt|var(--color-base-30)|#363636|color|2952|54,54,54,1','--background-modifier-cover|rgba(10, 10, 10, 0.4)|rgba(10, 10, 10, 0.4)|color|2959|10,10,10,0.4',
  '--input-shadow|inset 0 0.5px 0.5px 0.5px rgba(255, 255, 255, 0.09), 0 2px 4px 0 rgba(0, 0, 0, 0.15), 0 1px 1.5px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.2), 0 0 0 0 transparent|inset 0 0.5px 0.5px 0.5px rgba(255, 255, 255, 0.09), 0 2px 4px 0 rgba(0, 0, 0, 0.15), 0 1px 1.5px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.2), 0 0 0 0 transparent|text|2962','--input-shadow-hover|inset 0 0.5px 1px 0.5px rgba(255, 255, 255, 0.16), 0 2px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 1.5px 0 rgba(0, 0, 0, 0.2), 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 0 0 0 transparent|inset 0 0.5px 1px 0.5px rgba(255, 255, 255, 0.16), 0 2px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 1.5px 0 rgba(0, 0, 0, 0.2), 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 0 0 0 transparent|text|2963',
  '--shadow-s|0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3)|0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3)|text|2965','--shadow-l|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 30px 90px rgba(0, 0, 0, 0.2)|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 30px 90px rgba(0, 0, 0, 0.2)|text|2966',
  '--slider-thumb-width|30px|30px|text|2971','--toggle-width|44px|44px|text|2972',
  '--toggle-radius|24px|24px|text|2973','--toggle-thumb-height|16px|16px|text|2975',
  '--toggle-thumb-width|26px|26px|text|2976','--font-text-size|16px|16px|text|3055',
  '--zoom-factor|1|1|text|3959','--titlebar-height|30px|30px|text|3960',
].reduce((m,row)=>{const p=row.split('|');m[p[0]]={raw:p[1],value:p[2],kind:p[3],line:+p[4],rgba:p[5]?p[5].split(',').map(Number):undefined};return m;},{}),
};
const EXPECT=EXPECT_TABLE;
const SWATCH_NAMES=["--background-primary","--background-primary-alt","--background-secondary","--background-secondary-alt","--background-modifier-border","--background-modifier-hover","--interactive-accent","--interactive-accent-hover","--text-accent","--text-normal","--text-muted","--text-faint","--titlebar-background","--titlebar-background-focused","--ribbon-background","--status-bar-background","--tab-container-background","--tab-background-active","--divider-color","--scrollbar-thumb-bg","--callout-info","--callout-warning","--callout-success","--callout-error","--callout-quote","--code-background","--blockquote-border-color","--tag-background","--link-unresolved-decoration-color","--checkbox-color","--text-selection","--text-highlight-bg","--canvas-dot-pattern","--graph-node-tag","--graph-node-attachment"];

/* ---------------------------------------------------------------- 探针宿主 */
const host=document.createElement('div');
host.setAttribute('data-theme-token-probe','1');
host.style.cssText='position:fixed;left:-20000px;top:0;width:200px;height:40px;overflow:hidden;contain:strict;';
document.body.appendChild(host);
const colorProbe=document.createElement('div');host.appendChild(colorProbe);
const sizeHost=document.createElement('div');sizeHost.style.fontSize='16px';host.appendChild(sizeHost);
const body=document.body;
const varOf=(name,el)=>norm(getComputedStyle(el||body).getPropertyValue(name));
const parseRgb=text=>{const m=norm(text).match(/^rgba?\(([^)]+)\)$/);if(!m)return null;const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);if(p.length<3||p.some(n=>Number.isNaN(n)))return null;return [p[0],p[1],p[2],p.length>3?p[3]:1];};
const colorOf=name=>{colorProbe.style.backgroundColor='rgba(1, 2, 3, 0.4)';colorProbe.style.backgroundColor='var('+name+')';const v=norm(getComputedStyle(colorProbe).backgroundColor);colorProbe.style.backgroundColor='';return v;};
const pxOf=name=>{const el=document.createElement('span');el.style.fontSize='var('+name+')';sizeHost.appendChild(el);const v=parseFloat(getComputedStyle(el).fontSize);el.remove();return v;};
/* 展开 var()：把两侧拉到同一形态再比较（Chrome 对自定义属性只做一层替换） */
const expand=(text)=>{let out=String(text);for(let i=0;i<12;i++){const m=out.match(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*?)\s*)?\)/);if(!m)break;const inner=varOf(m[1]);const rep=inner!==''?inner:(m[2]!==undefined?m[2]:'');if(rep==='')break;out=out.slice(0,m.index)+rep+out.slice(m.index+m[0].length);}return norm(out);};

/* ---------------------------------------------------------------- 主题装载 */
const originalTheme=body.hasClass&&body.hasClass('theme-dark')?'dark':'light';
check(!body.style.getPropertyValue('--accent-h'),'运行前 body 无内联 --accent-h（默认主题色 = app.css 258/88/66）');

const applyTheme=async(mode)=>{
  if(mode==='light')app.settings.updateAppearance({theme:'moonstone'});
  else app.settings.updateAppearance({theme:'obsidian'});
  await wait(160);
  const cls=String(body.className);
  check(mode==='light'?/\btheme-light\b/.test(cls)&&!/\btheme-dark\b/.test(cls):/\btheme-dark\b/.test(cls)&&!/\btheme-light\b/.test(cls),'主题类生效（'+mode+'）：'+cls.split(/\s+/).filter(c=>/^theme-/.test(c)).join(' '));
};

const expectLabel=item=>item.kind==='color'?'rgb('+item.rgba.slice(0,3).join(', ')+')'+(item.rgba[3]<1?' α'+item.rgba[3]:''):'"'+item.value+'"';
const swatchNames=SWATCH_NAMES.filter(n=>EXPECT.light[n]);
const swatches={light:{},dark:{}};
const runTheme=async(mode)=>{
  const expected=EXPECT[mode];
  const problems=[];
  for(const name of Object.keys(expected)){
    const item=expected[name];
    if(item.kind==='color'){
      const got=parseRgb(colorOf(name));
      if(!got){problems.push(name+' 不是可解析颜色（期望 '+item.value+'）');continue;}
      const ok=near(got[0],item.rgba[0],1)&&near(got[1],item.rgba[1],1)&&near(got[2],item.rgba[2],1)&&near(got[3],item.rgba[3],0.005);
      if(!ok)problems.push(name+' = '+colorOf(name)+'，期望 '+expectLabel(item)+'（app.css:'+item.line+'）');
    }else{
      const got=expand(varOf(name));
      if(got!==item.value)problems.push(name+' = "'+got+'"（原值 '+item.raw+'），期望 "'+item.value+'"（app.css:'+item.line+'）');
    }
  }
  /* 原版在深色下没有 --shadow-edges（app.css 仅 .theme-light:2908 定义），--shadow-xs 因此失效；两侧必须同为失效 */
  const shadowEdges=varOf('--shadow-edges');
  const shadowXs=varOf('--shadow-xs');
  if(mode==='dark'){
    check(shadowEdges===''&&shadowXs==='','深色下 --shadow-edges/--shadow-xs 与 app.css 一致地失效（app.css 2908 仅浅色定义）');
  }else{
    check(shadowEdges==='0 0 transparent'&&/^0 1px 6px/.test(shadowXs),'浅色下 --shadow-edges/--shadow-xs 有值（app.css:2908-2909）');
  }
  /* h1-h6 尺寸必须真实解析为 px（em 相对 16px 正文） */
  for(const [tag,size] of Object.entries({'h1':'--h1-size','h2':'--h2-size','h3':'--h3-size','h4':'--h4-size','h5':'--h5-size','h6':'--h6-size'})){
    const got=pxOf(size);
    const want=Math.round(16*parseFloat(expected[size].value)*1000)/1000;
    check(near(got,want,0.01),tag+' 字号解析 = '+got+'px，期望 '+want+'px（16px × '+expected[size].value+'，app.css:'+expected[size].line+'）');
  }
  /* calc 类令牌：custom property 里 calc 不折叠，故再经真实属性解析验证有效值 */
  const computedOf=(name,setProp,readProp)=>{const el=document.createElement('div');el.style.setProperty(setProp,'var('+name+')');sizeHost.appendChild(el);const v=norm(getComputedStyle(el).getPropertyValue(readProp));el.remove();return v;};
  const accent=mode==='dark'?'rgb(138, 92, 245)':'rgb(152, 115, 247)';
  const calcCases=[
    ['--bold-weight','font-weight','font-weight','600','app.css:2095 = 400 + 200'],
    ['--callout-title-weight','font-weight','font-weight','600','app.css:2122 = 400 + 200'],
    ['--list-indent','text-indent','text-indent','36px','app.css:2420 = 0.5625em × 4 × 16px'],
    ['--heading-spacing','margin-top','margin-top','40px','app.css:2287 = 1rem × 2.5'],
    ['--embed-border-start','border-inline-start','border-inline-start-width','2px','app.css:2216'],
    ['--embed-border-start','border-inline-start','border-inline-start-color',accent,'app.css:2216 = 2px solid var(--interactive-accent)'],
  ];
  for(const [name,setProp,readProp,want,why] of calcCases){
    const got=computedOf(name,setProp,readProp);
    check(got===want,name+' 经 '+setProp+' 解析的 '+readProp+' = '+got+'，期望 '+want+'（'+why+'）');
  }
  /* 依赖运行期类名的令牌：原版 app.css 里由 body.is-frameless.is-hidden-frameless 覆写 */
  const canvasColor=varOf('--canvas-color');
  check(canvasColor===(mode==='dark'?'126, 126, 126':'192, 192, 192'),'--canvas-color = '+canvasColor+'，期望 '+(mode==='dark'?'126, 126, 126':'192, 192, 192')+'（app.css:'+(mode==='dark'?16426:16423)+'）');
  const hiddenFrameless=body.hasClass('is-hidden-frameless');
  const dividerHeight=varOf('--divider-vertical-height');
  check(dividerHeight===(hiddenFrameless?'100%':'calc(100% - 40px)'),'--divider-vertical-height = '+dividerHeight+'，期望 '+(hiddenFrameless?'100%（is-hidden-frameless，app.css:4008）':'calc(100% - 40px)（app.css:2199）'));
  count+=Object.keys(expected).length;failures.push(...problems);
  /* 记录本主题下的色块解析值，供结尾的对照面板截图取证 */
  for(const name of swatchNames){
    const item=expected[name];
    if(item)swatches[mode][name]=item.kind==='color'?colorOf(name):varOf(name);
  }
  return problems;
};

await applyTheme('light');
const lightProblems=await runTheme('light');
await applyTheme('dark');
const darkProblems=await runTheme('dark');

/* 直接切换类名也必须整体翻转（场景自身驱动，不依赖 app API） */
body.classList.remove('theme-dark');body.classList.add('theme-light');await wait(60);
const flipped=varOf('--background-primary');
check(flipped==='#ffffff','直接切 theme-light 后 --background-primary = '+flipped+'，期望 #ffffff');
body.classList.remove('theme-light');body.classList.add('theme-dark');await wait(60);
const back=varOf('--background-primary');
check(back==='#1e1e1e','直接切 theme-dark 后 --background-primary = '+back+'，期望 #1e1e1e');

/* 令牌消费实证：env() 钩子让消费者的 max() 生效（原版 app.css:17743 + 5990） */
const safeBottom=varOf('--safe-area-inset-bottom');
check(safeBottom==='0px','--safe-area-inset-bottom = "'+safeBottom+'"（桌面上 env() 解析为 0px），期望 "0px"（app.css:17743）');
const linkProbe=document.createElement('div');linkProbe.className='outgoing-link-pane';host.appendChild(linkProbe);
const linkPad=norm(getComputedStyle(linkProbe).paddingBottom);
check(linkPad==='32px','.outgoing-link-pane 底部内边距 = '+linkPad+'，期望 32px（max(0px, var(--size-4-8))，app.css:5990）');

/* ---------------------------------------------------------------- 色块对照面板（截图取证） */
const panel=document.createElement('div');
panel.setAttribute('data-theme-token-swatches','1');
/* 每个色块：左=应用当前解析值，右=app.css 推导值。通道三元组（如 --callout-quote）按 rgb() 呈现。 */
const refOf=(item)=>{
  if(item.kind==='color')return {css:'rgb('+item.rgba.slice(0,3).join(', ')+')'+(item.rgba[3]<1?' / '+item.rgba[3]:''),label:item.rgba.slice(0,3).join(', ')};
  const m=String(item.value).match(/^(\d+), (\d+), (\d+)$/);
  if(m)return {css:'rgb('+m[1]+', '+m[2]+', '+m[3]+')',label:item.value};
  return null;
};
const rows=swatchNames.map(name=>{
  const lightRef=refOf(EXPECT.light[name]),darkRef=refOf(EXPECT.dark[name]);
  if(!lightRef||!darkRef)return null;
  const mine=(mode)=>{
    const got=String(swatches[mode][name]||'');
    if(/^(rgba?|hsla?)\(/.test(got))return got;
    const m=got.match(/^(\d+), (\d+), (\d+)$/);
    return m?'rgb('+m[1]+', '+m[2]+', '+m[3]+')':'rgba(0, 0, 0, 0)';
  };
  const cells=[['light',lightRef],['dark',darkRef]].map(([mode,ref])=>
    '<td style="background:'+mine(mode)+';width:26px"></td><td style="background:'+ref.css+';width:26px"></td><td class="v">'+ref.label+'</td>').join('');
  return '<tr><td class="n">'+name.replace('--','')+'</td>'+cells+'</tr>';
}).filter(Boolean).join('');
panel.innerHTML='<div class="hd">主题变量逐条对照 · 每行：变量 | 浅色 我们 | 浅色 app.css | 深色 我们 | 深色 app.css | 期望 RGB · 差异 '+(lightProblems.length+darkProblems.length)+' 项</div>'+
  '<table><thead><tr><th></th><th>L</th><th>ref</th><th class="v">rgb</th><th>D</th><th>ref</th><th class="v">rgb</th></tr></thead><tbody>'+rows+'</tbody></table>';
panel.style.cssText='position:fixed;right:57px;top:40px;z-index:99999;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;padding:6px 8px;font:11px/1.35 var(--font-interface);box-shadow:var(--shadow-s);max-height:96vh;overflow:hidden';
const style=document.createElement('style');
style.textContent='[data-theme-token-swatches] table{border-collapse:collapse}[data-theme-token-swatches] td{padding:0;height:13px;border:1px solid var(--background-modifier-border)}[data-theme-token-swatches] .n,[data-theme-token-swatches] .v{font-family:var(--font-monospace);font-size:9px;color:var(--text-muted);padding:0 5px!important;white-space:nowrap}[data-theme-token-swatches] .hd{font-weight:bold;margin-bottom:4px}[data-theme-token-swatches] th{font-size:9px;color:var(--text-faint);font-weight:normal}';
document.head.appendChild(style);
document.body.appendChild(panel);

host.remove();
if(failures.length){
  const head=failures.slice(0,60).join('\n');
  throw Error('主题变量对齐失败 '+failures.length+' 项（共断言 '+count+'）：\n'+head+(failures.length>60?'\n…其余 '+(failures.length-60)+' 项':''));
}
return {pass:true,count,theme:originalTheme,swatches:swatchNames.length,panel:true};
})()

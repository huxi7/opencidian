/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；期望值由 _analysis/obsidian-114/renderer/app.css 逐条提取。
 * [OUTPUT]: 浅/深两套主题下设计变量的逐条对齐断言；失败时抛出差异清单，成功返回 pass 与断言数。
 * [POS]: scripts/acceptance 的永久主题地基场景。期望值内联在下方 EXPECT（来源行号见每项 line）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* 覆盖边界（按证据判定）：
 * 覆盖：body(app.css:2020-2979)/.theme-light(2981-3030)/.theme-dark(3031-3095)/.mod-macos(3096-3126)
 *   /:root(2001-2019) 中本应用实际消费的 374 项变量（每主题逐条断言 374 项，npm 结果的 checks 含以下追加断言）。
 *   追加断言：每主题 15 项（--shadow-edges/--shadow-xs 一致性、h1-h6 字号 px 解析、calc 令牌经真实属性解析、
 *   --canvas-color、--divider-vertical-height 类名分支）+ 主题装载 3 项 + 类名直切 2 项 + safe-area 消费 2 项。
 * 不覆盖·原版 PDF.js 内部变量（app.css 1443/1775/1791/1803/1810/1811-1815 的 --xfa-*、--csstools-*、
 *   --viewer-container-height、--page-margin、--page-border、--focus-ring-*、--loading-icon-delay、
 *   --spreadHorizontalWrapped-margin-LR）：本应用不含 PDF 阅读器（无非 pdfjs 依赖，src 无 pdfViewer/annotationLayer）。
 * 不覆盖·运行时内联值：--accent-h/s/l、--font-*-override、--indent-size（app.js _applyTheme）、
 *   --zoom-factor（workspace-renderer 按 webFrame 缩放写入）。场景先断言默认主题色前提，再校验全部派生色。
 * 不覆盖·组件级同名变量：--pill-focus-width/left-adjust（markdown-properties.css）、--canvas-color（canvas-nodes.css）。
 *   场景在 body 级断言其最终值（--canvas-color），组件级规则不属于本文件的验收范围。
 * 照搬原版缺口：深色下原版未定义 --shadow-edges（app.css:3014 仅浅色定义），故 --shadow-xs 深色失效；
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
   由 _analysis/obsidian-114/renderer/app.css 的 body(2020-2979)/.theme-light(2981-3030)/.theme-dark(3031-3095)
   /.mod-macos(3096-3126) 块 + :root(2001) 块按 CSS 变量替换规则解析得到
   （var() 递归替换、calc() 折叠、hsl()/oklch()/color-mix() 转 sRGB）。 */
const EXPECT_TABLE={
light:[
  '--h1-weight|700|700|text|2002','--h2-weight|600|680|text|2003',
  '--h3-weight|600|660|text|2004','--h4-weight|600|640|text|2005',
  '--h5-weight|600|620|text|2006','--h6-weight|600|600|text|2007',
  '--blockquote-border-thickness|2px|2px|text|2103','--blockquote-border-color|var(--interactive-accent)|#9873f7|color|2104|152,115,247,1',
  '--blockquote-font-style|normal|normal|text|2105','--blockquote-color|inherit||text|2106',
  '--blockquote-background-color|transparent|rgba(0, 0, 0, 0)|color|2107|0,0,0,0','--bold-color|inherit||text|2110',
  '--bold-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2111','--callout-border-width|0px|0px|text|2131',
  '--callout-border-opacity|0.25|0.25|text|2132','--callout-radius|var(--radius-s)|4px|text|2134',
  '--callout-blend-mode|var(--highlight-mix-blend-mode)|darken|text|2135','--callout-title-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2139',
  '--callout-bug|var(--color-red)|233, 49, 71|text|2142','--callout-default|var(--color-blue)|8, 109, 221|text|2143',
  '--callout-error|var(--color-red)|233, 49, 71|text|2144','--callout-example|var(--color-purple)|120, 82, 238|text|2145',
  '--callout-fail|var(--color-red)|233, 49, 71|text|2146','--callout-important|var(--color-cyan)|0, 191, 188|text|2147',
  '--callout-info|var(--color-blue)|8, 109, 221|text|2148','--callout-question|var(--color-orange)|236, 117, 0|text|2149',
  '--callout-success|var(--color-green)|8, 185, 78|text|2150','--callout-summary|var(--color-cyan)|0, 191, 188|text|2151',
  '--callout-tip|var(--color-cyan)|0, 191, 188|text|2152','--callout-todo|var(--color-blue)|8, 109, 221|text|2153',
  '--callout-warning|var(--color-orange)|236, 117, 0|text|2154','--callout-quote|#9e9e9e|158, 158, 158|text|2155',
  '--canvas-background|var(--background-primary)|#ffffff|color|2157|255,255,255,1','--canvas-card-label-color|var(--text-faint)|#ababab|color|2158|171,171,171,1',
  '--canvas-color-1|var(--color-red)|233, 49, 71|text|2159','--canvas-color-2|var(--color-orange)|236, 117, 0|text|2160',
  '--canvas-color-3|var(--color-yellow)|224, 172, 0|text|2161','--canvas-color-4|var(--color-green)|8, 185, 78|text|2162',
  '--canvas-color-5|var(--color-cyan)|0, 191, 188|text|2163','--canvas-color-6|var(--color-purple)|120, 82, 238|text|2164',
  '--canvas-dot-pattern|var(--color-base-30)|#e4e4e4|color|2168|228,228,228,1','--caret-color|var(--text-normal)|#222222|color|2170|34,34,34,1',
  '--checkbox-radius|var(--radius-s)|4px|text|2172','--checkbox-size|var(--font-preferred-size)|16px|text|2173',
  '--checkbox-marker-color|var(--background-primary)|#ffffff|color|2174|255,255,255,1','--checkbox-color|var(--interactive-accent)|#9873f7|color|2175|152,115,247,1',
  '--checkbox-color-hover|var(--interactive-accent-hover)|#a68af9|color|2176|166,138,249,1','--checkbox-border-color|var(--text-faint)|#ababab|color|2177|171,171,171,1',
  '--checkbox-border-color-hover|var(--text-muted)|#5c5c5c|color|2178|92,92,92,1','--code-white-space|pre-wrap|pre-wrap|text|2183',
  '--code-radius|var(--radius-s)|4px|text|2187','--code-size|var(--font-smaller)|0.875em|text|2188',
  '--code-background|var(--background-primary-alt)|#fafafa|color|2189|250,250,250,1','--code-normal|var(--text-normal)|#222222|color|2190|34,34,34,1',
  '--code-comment|var(--text-faint)|#ababab|color|2191|171,171,171,1','--code-function|var(--color-yellow)|#e0ac00|color|2192|224,172,0,1',
  '--code-important|var(--color-orange)|#ec7500|color|2193|236,117,0,1','--code-keyword|var(--color-pink)|#d53984|color|2194|213,57,132,1',
  '--code-operator|var(--color-red)|#e93147|color|2195|233,49,71,1','--code-property|var(--color-cyan)|#00bfbc|color|2196|0,191,188,1',
  '--code-punctuation|var(--text-muted)|#5c5c5c|color|2197|92,92,92,1','--code-string|var(--color-green)|#08b94e|color|2198|8,185,78,1',
  '--code-tag|var(--color-red)|#e93147|color|2199|233,49,71,1','--code-value|var(--color-purple)|#7852ee|color|2200|120,82,238,1',
  '--collapse-icon-color|var(--text-faint)|#ababab|color|2202|171,171,171,1','--collapse-icon-color-collapsed|var(--text-accent)|#8a5cf5|color|2203|138,92,245,1',
  '--cursor|default|default|text|2205','--cursor-link|pointer|pointer|text|2206',
  '--divider-color|var(--background-modifier-border)|#e4e4e4|color|2212|228,228,228,1','--divider-color-hover|var(--interactive-accent)|#9873f7|color|2213|152,115,247,1',
  '--divider-width|1px|1px|text|2214','--divider-width-hover|3px|3px|text|2215',
  '--embed-background|inherit||text|2239','--embed-border-start|2px solid var(--interactive-accent)|2px solid hsl(calc(258 - 1), calc(88% * 1.01), calc(66% * 1.075))|text|2240',
  '--embed-padding|0 0 0 var(--size-4-6)|0 0 0 24px|text|2244','--embed-font-style|inherit||text|2245',
  '--file-line-width|700px|700px|text|2257','--file-folding-offset|24px|24px|text|2258',
  '--file-margins|var(--file-margins-y) var(--file-margins-x)|32px 32px|text|2259','--font-smallest|0.8em|0.8em|text|2271',
  '--font-smaller|0.875em|0.875em|text|2272','--font-small|0.933em|0.933em|text|2273',
  '--font-ui-smaller|12px|12px|text|2278','--font-ui-small|13px|13px|text|2279',
  '--font-ui-medium|15px|15px|text|2280','--font-ui-large|20px|20px|text|2281',
  '--font-weight|var(--font-normal)|400|text|2283','--font-thin|100|100|text|2284',
  '--font-extralight|200|200|text|2285','--font-light|300|300|text|2286',
  '--font-normal|400|400|text|2287','--font-medium|500|500|text|2288',
  '--font-semibold|600|600|text|2289','--font-bold|700|700|text|2290',
  '--font-extrabold|800|800|text|2291','--font-black|900|900|text|2292',
  '--graph-controls-width|240px|240px|text|2309','--graph-text|var(--text-normal)|#222222|color|2310|34,34,34,1',
  '--graph-line|var(--color-base-35, var(--background-modifier-border-focus))|#dadada|color|2311|218,218,218,1','--graph-node|var(--text-muted)|#5c5c5c|color|2312|92,92,92,1',
  '--graph-node-unresolved|var(--text-faint)|#ababab|color|2313|171,171,171,1','--graph-node-focused|var(--text-accent)|#8a5cf5|color|2314|138,92,245,1',
  '--graph-node-tag|var(--color-green)|#08b94e|color|2315|8,185,78,1','--graph-node-attachment|var(--color-yellow)|#e0ac00|color|2316|224,172,0,1',
  '--heading-spacing|calc(var(--p-spacing) * 2.5)|calc(1rem * 2.5)|text|2319','--h1-letter-spacing|-0.015em|-0.015em|text|2332',
  '--h2-letter-spacing|-0.011em|-0.011em|text|2333','--h3-letter-spacing|-0.008em|-0.008em|text|2334',
  '--h4-letter-spacing|-0.005em|-0.005em|text|2335','--h5-letter-spacing|-0.002em|-0.002em|text|2336',
  '--h6-letter-spacing|0em|0em|text|2337','--h1-line-height|1.2|1.2|text|2338',
  '--h2-line-height|1.2|1.2|text|2339','--h3-line-height|1.3|1.3|text|2340',
  '--h4-line-height|1.4|1.4|text|2341','--h5-line-height|var(--line-height-normal)|1.5|text|2342',
  '--h6-line-height|var(--line-height-normal)|1.5|text|2343','--h1-size|1.618em|1.618em|text|2344',
  '--h2-size|1.462em|1.462em|text|2345','--h3-size|1.318em|1.318em|text|2346',
  '--h4-size|1.188em|1.188em|text|2347','--h5-size|1.076em|1.076em|text|2348',
  '--h6-size|1em|1em|text|2349','--hr-color|var(--background-modifier-border)|#e4e4e4|color|2369|228,228,228,1',
  '--hr-thickness|2px|2px|text|2370','--icon-size|var(--icon-m)|16px|text|2381',
  '--icon-color|var(--text-muted)|#5c5c5c|color|2393|92,92,92,1','--icon-color-hover|var(--text-muted)|#5c5c5c|color|2394|92,92,92,1',
  '--icon-color-active|var(--text-accent)|#8a5cf5|color|2395|138,92,245,1','--icon-opacity|0.85|0.85|text|2397',
  '--indentation-guide-width|var(--border-width)|1px|text|2407','--indentation-guide-color|color-mix(in oklch, var(--mono-100) 12%, transparent)|rgba(0, 0, 0, 0.12)|color|2409|0,0,0,0.12',
  '--indentation-guide-color-active|color-mix(in oklch, var(--mono-100) 30%, transparent)|rgba(0, 0, 0, 0.3)|color|2410|0,0,0,0.3','--inline-title-size|var(--h1-size)|1.618em|text|2418',
  '--inline-title-weight|var(--h1-weight)|700|text|2421','--input-height|30px|30px|text|2424',
  '--input-radius|var(--radius-m)|8px|text|3099','--input-border-width|var(--border-width)|1px|text|2429',
  '--input-placeholder-color|var(--text-faint)|#ababab|color|2431|171,171,171,1','--italic-color|inherit||text|2436',
  '--italic-weight|inherit||text|2437','--layer-popover|30|30|text|2442',
  '--layer-modal|50|50|text|2444','--layer-notice|60|60|text|2445',
  '--layer-menu|65|65|text|2446','--layer-tooltip|70|70|text|2447',
  '--line-height-normal|1.5|1.5|text|2454','--line-height-tight|1.3|1.3|text|2455',
  '--link-color|var(--text-accent)|#8a5cf5|color|2457|138,92,245,1','--link-color-hover|var(--text-accent-hover)|#a68af9|color|2458|166,138,249,1',
  '--link-decoration|underline|underline|text|2459','--link-decoration-hover|underline|underline|text|2460',
  '--link-decoration-thickness|auto|auto|text|2461','--link-weight|var(--font-weight)|400|text|2462',
  '--link-external-color|var(--text-accent)|#8a5cf5|color|2463|138,92,245,1','--link-external-color-hover|var(--text-accent-hover)|#a68af9|color|2464|166,138,249,1',
  '--link-external-decoration|underline|underline|text|2465','--link-external-decoration-hover|underline|underline|text|2466',
  '--link-external-filter|none|none|text|2467','--link-unresolved-color|var(--text-accent)|#8a5cf5|color|2468|138,92,245,1',
  '--link-unresolved-opacity|0.7|0.7|text|2469','--link-unresolved-filter|none|none|text|2470',
  '--link-unresolved-decoration-style|solid|solid|text|2471','--link-unresolved-decoration-color|color-mix(in oklch, var(--interactive-accent) 30%, transparent)|rgba(152, 115, 247, 0.3)|color|2472|152,115,247,0.3',
  '--list-indent|calc(var(--indent-unit) * var(--indent-size))|calc(0.5625em * 4)|text|2474','--list-marker-color|var(--text-faint)|#ababab|color|2478|171,171,171,1',
  '--list-marker-color-hover|var(--text-muted)|#5c5c5c|color|2479|92,92,92,1','--nav-item-size|var(--font-ui-small)|13px|text|2488',
  '--nav-item-color|var(--text-muted)|#5c5c5c|color|2490|92,92,92,1','--nav-item-color-hover|var(--text-normal)|#222222|color|2491|34,34,34,1',
  '--nav-item-color-active|var(--text-normal)|#222222|color|2492|34,34,34,1','--nav-item-background-hover|var(--background-modifier-hover)|rgba(0, 0, 0, 0.067)|color|2495|0,0,0,0.067',
  '--nav-item-background-selected|color-mix(in oklch, var(--color-accent) 15%, transparent)|rgba(138, 92, 245, 0.15)|color|2497|138,92,245,0.15','--menu-background|var(--background-secondary)|#f6f6f6|color|2540|246,246,246,1',
  '--metadata-background|transparent|rgba(0, 0, 0, 0)|color|2546|0,0,0,0','--metadata-divider-color|var(--background-modifier-border)|#e4e4e4|color|2554|228,228,228,1',
  '--metadata-property-background-active|var(--background-modifier-hover)|rgba(0, 0, 0, 0.067)|color|2568|0,0,0,0.067','--metadata-label-text-color|var(--text-muted)|#5c5c5c|color|2577|92,92,92,1',
  '--metadata-input-text-color|var(--text-normal)|#222222|color|2581|34,34,34,1','--modal-background|var(--background-primary)|#ffffff|color|2592|255,255,255,1',
  '--modal-width|90vw|90vw|text|2594','--modal-max-width|1100px|1100px|text|2597',
  '--modal-border-width|var(--border-width)|1px|text|2601','--modal-border-color|var(--background-modifier-border-hover)|#dadada|color|2602|218,218,218,1',
  '--modal-radius|var(--radius-xl)|24px|text|3105','--modal-community-sidebar-width|280px|280px|text|2604',
  '--pill-color|var(--text-muted)|#5c5c5c|color|2606|92,92,92,1','--pill-background|transparent|rgba(0, 0, 0, 0)|color|2612|0,0,0,0',
  '--pill-border-color|var(--background-modifier-border)|#e4e4e4|color|2614|228,228,228,1','--pill-padding-x|0.65em|0.65em|text|2617',
  '--pill-radius|2em|2em|text|2619','--prompt-background|var(--background-primary)|#ffffff|color|2639|255,255,255,1',
  '--prompt-input-height|40px|40px|text|2641','--prompt-width|700px|700px|text|2642',
  '--prompt-max-width|80vw|80vw|text|2643','--prompt-border-width|var(--border-width)|1px|text|2645',
  '--prompt-border-color|var(--background-modifier-border-hover)|#dadada|color|2646|218,218,218,1','--ribbon-background|var(--background-secondary)|#f6f6f6|color|2663|246,246,246,1',
  '--ribbon-background-collapsed|var(--background-primary)|#ffffff|color|2664|255,255,255,1','--ribbon-width|44px|44px|text|2665',
  '--ribbon-padding|var(--size-4-2) var(--size-4-1) var(--size-4-3)|8px 4px 12px|text|2666','--scrollbar-width|12px|12px|text|2668',
  '--scrollbar-height|12px|12px|text|2669','--scrollbar-border-width|3px 3px 3px 2px|3px 3px 3px 2px|text|2670',
  '--scrollbar-radius|var(--radius-l)|12px|text|2671','--scrollbar-active-thumb-bg|color-mix(in oklch, var(--mono-100) 20%, transparent)|rgba(0, 0, 0, 0.2)|color|2672|0,0,0,0.2',
  '--scrollbar-bg|transparent|rgba(0, 0, 0, 0)|color|2673|0,0,0,0','--scrollbar-thumb-bg|gray|#808080|color|3106|128,128,128,1',
  '--status-bar-background|var(--background-secondary)|#f6f6f6|color|2761|246,246,246,1','--status-bar-border-color|var(--divider-color)|#e4e4e4|color|2762|228,228,228,1',
  '--status-bar-border-width|var(--border-width) 0 0 var(--border-width)|1px 0 0 1px|text|2763','--status-bar-font-size|var(--font-ui-smaller)|12px|text|2764',
  '--status-bar-text-color|var(--text-muted)|#5c5c5c|color|2765|92,92,92,1','--status-bar-position|fixed|fixed|text|2766',
  '--status-bar-radius|var(--radius-m) 0 0 0|8px 0 0 0|text|2767','--tab-background-active|var(--background-primary)|#ffffff|color|2789|255,255,255,1',
  '--tab-text-color|var(--text-faint)|#ababab|color|2797|171,171,171,1','--tab-text-color-active|var(--text-muted)|#5c5c5c|color|2798|92,92,92,1',
  '--tab-text-color-focused|var(--text-muted)|#5c5c5c|color|2799|92,92,92,1','--tab-text-color-focused-active|var(--text-muted)|#5c5c5c|color|2800|92,92,92,1',
  '--tab-text-color-focused-highlighted|var(--text-accent)|#8a5cf5|color|2801|138,92,245,1','--tab-text-color-focused-active-current|var(--text-normal)|#222222|color|2802|34,34,34,1',
  '--tab-font-size|var(--font-ui-small)|13px|text|2803','--tab-font-weight|inherit||text|2804',
  '--tab-container-background|var(--background-secondary)|#f6f6f6|color|2805|246,246,246,1','--tab-divider-color|var(--background-modifier-border-hover)|#dadada|color|2808|218,218,218,1',
  '--tab-outline-color|var(--divider-color)|#e4e4e4|color|2809|228,228,228,1','--tab-outline-width|1px|1px|text|2811',
  '--tab-curve|10px|10px|text|2813','--tab-radius|var(--radius-m)|8px|text|3115',
  '--tab-radius-active|10px 10px 0 0|10px 10px 0 0|text|2815','--tab-width|200px|200px|text|2816',
  '--tab-max-width|320px|320px|text|2817','--tab-switcher-background|var(--background-secondary)|#f6f6f6|color|2820|246,246,246,1',
  '--tab-stacked-pane-width|700px|700px|text|2827','--tab-stacked-header-width|var(--header-height)|40px|text|2828',
  '--tab-stacked-shadow|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|text|2834','--table-background|transparent|rgba(0, 0, 0, 0)|color|2836|0,0,0,0',
  '--table-border-color|var(--background-modifier-border)|#e4e4e4|color|2838|228,228,228,1','--table-header-background|var(--table-background)|rgba(0, 0, 0, 0)|color|2840|0,0,0,0',
  '--table-header-color|var(--text-normal)|#222222|color|2847|34,34,34,1','--table-row-background-hover|var(--table-background)|rgba(0, 0, 0, 0)|color|2856|0,0,0,0',
  '--tag-size|var(--font-smaller)|0.875em|text|2875','--tag-color|var(--text-accent)|#8a5cf5|color|2876|138,92,245,1',
  '--tag-color-hover|var(--text-accent)|#8a5cf5|color|2877|138,92,245,1','--tag-background|color-mix(in oklch, var(--interactive-accent) 10%, transparent)|rgba(152, 115, 247, 0.1)|color|2880|152,115,247,0.1',
  '--tag-background-hover|color-mix(in oklch, var(--interactive-accent) 20%, transparent)|rgba(152, 115, 247, 0.2)|color|2881|152,115,247,0.2','--tag-border-color|color-mix(in oklch, var(--interactive-accent) 15%, transparent)|rgba(152, 115, 247, 0.15)|color|2882|152,115,247,0.15',
  '--tag-border-color-hover|color-mix(in oklch, var(--interactive-accent) 15%, transparent)|rgba(152, 115, 247, 0.15)|color|2883|152,115,247,0.15','--tag-padding-x|0.65em|0.65em|text|2885',
  '--tag-radius|2em|2em|text|2887','--titlebar-background|var(--background-secondary)|#f6f6f6|color|2893|246,246,246,1',
  '--titlebar-background-focused|var(--background-secondary)|#f6f6f6|color|2894|246,246,246,1','--titlebar-border-width|0px|0px|text|2895',
  '--titlebar-border-color|var(--background-modifier-border)|#e4e4e4|color|2896|228,228,228,1','--titlebar-text-color|var(--text-muted)|#5c5c5c|color|2897|92,92,92,1',
  '--titlebar-text-color-focused|var(--text-normal)|#222222|color|2898|34,34,34,1','--titlebar-text-weight|var(--font-bold)|700|text|2899',
  '--vault-profile-color|var(--text-normal)|#222222|color|2932|34,34,34,1','--vault-profile-color-hover|var(--vault-profile-color)|#222222|color|2933|34,34,34,1',
  '--workspace-background-translucent|color-mix(in oklch, var(--mono-0) 60%, transparent)|rgba(255, 255, 255, 0.6)|color|2936|255,255,255,0.6','--accent-h|258|258|text|2939',
  '--accent-s|88%|88%|text|2940','--accent-l|66%|66%|text|2941',
  '--background-primary|var(--color-base-00)|#ffffff|color|2943|255,255,255,1','--background-primary-alt|var(--color-base-10)|#fafafa|color|2944|250,250,250,1',
  '--background-secondary|var(--color-base-20)|#f6f6f6|color|2945|246,246,246,1','--background-modifier-hover|color-mix(in oklch, var(--mono-100) 6.7%, transparent)|rgba(0, 0, 0, 0.067)|color|2946|0,0,0,0.067',
  '--background-modifier-border|var(--color-base-30)|#e4e4e4|color|2948|228,228,228,1','--background-modifier-border-hover|var(--color-base-35)|#dadada|color|2949|218,218,218,1',
  '--background-modifier-border-focus|var(--color-base-40)|#bdbdbd|color|2950|189,189,189,1','--background-modifier-error|var(--color-red)|#e93147|color|2951|233,49,71,1',
  '--background-modifier-success|var(--color-green)|#08b94e|color|2955|8,185,78,1','--background-modifier-message|color-mix(in oklch, black 90%, transparent)|rgba(0, 0, 0, 0.9)|color|2956|0,0,0,0.9',
  '--background-modifier-form-field|var(--color-base-00)|#ffffff|color|2958|255,255,255,1','--text-normal|var(--color-base-100)|#222222|color|2961|34,34,34,1',
  '--text-muted|var(--color-base-70)|#5c5c5c|color|2962|92,92,92,1','--text-faint|var(--color-base-50)|#ababab|color|2963|171,171,171,1',
  '--text-on-accent|white|#ffffff|color|2964|255,255,255,1','--text-error|var(--color-red)|#e93147|color|2966|233,49,71,1',
  '--text-warning|var(--color-orange)|#ec7500|color|2967|236,117,0,1','--text-success|var(--color-green)|#08b94e|color|2968|8,185,78,1',
  '--text-selection|color-mix(in oklch, var(--interactive-accent) 20%, transparent)|rgba(152, 115, 247, 0.2)|color|2969|152,115,247,0.2','--text-highlight-bg|rgba(var(--text-highlight-bg-rgb), 0.4)|rgba(255, 208, 0, 0.4)|color|2852|255,208,0,0.4',
  '--text-accent|var(--color-accent)|#8a5cf5|color|2970|138,92,245,1','--text-accent-hover|var(--color-accent-2)|#a68af9|color|2971|166,138,249,1',
  '--interactive-normal|var(--background-modifier-border)|#e4e4e4|color|3103|228,228,228,1','--interactive-hover|var(--background-modifier-border)|#e4e4e4|color|3104|228,228,228,1',
  '--interactive-accent|var(--color-accent-1)|#9873f7|color|2974|152,115,247,1','--interactive-accent-hover|var(--color-accent-2)|#a68af9|color|2975|166,138,249,1',
  '--dropdown-background|var(--interactive-normal)|#e4e4e4|color|2223|228,228,228,1','--dropdown-background-hover|var(--interactive-hover)|#e4e4e4|color|2224|228,228,228,1',
  '--highlight-mix-blend-mode|darken|darken|text|2983','--mono-rgb-0|255, 255, 255|255, 255, 255|text|3019',
  '--mono-rgb-100|0, 0, 0|0, 0, 0|text|3020','--color-red-rgb|233, 49, 71|233, 49, 71|text|3022',
  '--color-red|#e93147|#e93147|color|2986|233,49,71,1','--color-orange-rgb|236, 117, 0|236, 117, 0|text|3023',
  '--color-orange|#ec7500|#ec7500|color|2987|236,117,0,1','--color-yellow-rgb|224, 172, 0|224, 172, 0|text|3024',
  '--color-yellow|#e0ac00|#e0ac00|color|2988|224,172,0,1','--color-green-rgb|8, 185, 78|8, 185, 78|text|3025',
  '--color-green|#08b94e|#08b94e|color|2989|8,185,78,1','--color-cyan-rgb|0, 191, 188|0, 191, 188|text|3026',
  '--color-cyan|#00bfbc|#00bfbc|color|2990|0,191,188,1','--color-blue-rgb|8, 109, 221|8, 109, 221|text|3027',
  '--color-blue|#086ddd|#086ddd|color|2991|8,109,221,1','--color-purple-rgb|120, 82, 238|120, 82, 238|text|3028',
  '--color-purple|#7852ee|#7852ee|color|2992|120,82,238,1','--color-pink-rgb|213, 57, 132|213, 57, 132|text|3029',
  '--color-pink|#d53984|#d53984|color|2993|213,57,132,1','--color-base-00|#ffffff|#ffffff|color|2994|255,255,255,1',
  '--color-base-05|#fcfcfc|#fcfcfc|color|2995|252,252,252,1','--color-base-10|#fafafa|#fafafa|color|2996|250,250,250,1',
  '--color-base-20|#f6f6f6|#f6f6f6|color|2997|246,246,246,1','--color-base-25|#efefef|#efefef|color|2998|239,239,239,1',
  '--color-base-30|#e4e4e4|#e4e4e4|color|2999|228,228,228,1','--color-base-35|#dadada|#dadada|color|3000|218,218,218,1',
  '--color-base-40|#bdbdbd|#bdbdbd|color|3001|189,189,189,1','--color-base-50|#ababab|#ababab|color|3002|171,171,171,1',
  '--color-base-60|#707070|#707070|color|3003|112,112,112,1','--color-base-70|#5c5c5c|#5c5c5c|color|3004|92,92,92,1',
  '--color-base-100|#222222|#222222|color|3005|34,34,34,1','--color-accent|hsl(var(--accent-h), var(--accent-s), var(--accent-l))|#8a5cf5|color|3006|138,92,245,1',
  '--color-accent-1|hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))|#9873f7|color|3007|152,115,247,1','--color-accent-2|hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15))|#a68af9|color|3008|166,138,249,1',
  '--background-secondary-alt|var(--color-base-05)|#fcfcfc|color|3009|252,252,252,1','--background-modifier-cover|rgba(220, 220, 220, 0.4)|rgba(220, 220, 220, 0.4)|color|3011|220,220,220,0.4',
  '--input-shadow|none|none|text|3101','--input-shadow-hover|none|none|text|3102',
  '--shadow-s|0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07)|0px 1px 2px rgba(0, 0, 0, 0.028), 0px 3.4px 6.7px rgba(0, 0, 0, 0.042), 0px 15px 30px rgba(0, 0, 0, 0.07)|text|3016','--shadow-l|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 15px 30px rgba(0, 0, 0, 0.1)|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 15px 30px rgba(0, 0, 0, 0.1)|text|3017',
  '--slider-thumb-width|30px|30px|text|3110','--toggle-width|44px|44px|text|3116',
  '--toggle-radius|24px|24px|text|3117','--toggle-thumb-height|16px|16px|text|3119',
  '--toggle-thumb-width|26px|26px|text|3120','--font-text-size|16px|16px|text|3200',
  '--zoom-factor|1|1|text|4293','--titlebar-height|30px|30px|text|4294',
  '--font-preferred-size|var(--font-text-size)|16px|text|3201',
  '--mono-0|white|#ffffff|color|2984|255,255,255,1',
  '--mono-100|black|#000000|color|2985|0,0,0,1',
  '--modal-sidebar-background|var(--modal-background)|#ffffff|color|2593|255,255,255,1',
  '--settings-background|var(--modal-background)|#ffffff|color|2686|255,255,255,1',
  '--setting-items-padding-x|var(--size-4-5)|20px|text|2692',
  '--setting-items-padding-y|var(--size-4-5)|20px|text|2693',
  '--setting-item-name-color|var(--text-normal)|#222222|color|2699|34,34,34,1',
  '--setting-item-name-size|var(--font-ui-small)|13px|text|2700',
  '--setting-item-name-weight|var(--font-normal)|400|text|2701',
  '--tooltip-background|var(--background-modifier-message)|rgba(0, 0, 0, 0.9)|color|2704|0,0,0,0.9',
  '--tooltip-color|#FAFAFA|#fafafa|color|2705|250,250,250,1',
  '--tooltip-font-size|var(--font-ui-small)|13px|text|2706',
  '--tooltip-font-weight|var(--font-normal)|400|text|2707',
  '--tooltip-line-height|var(--line-height-tight)|1.3|text|2708',
  '--tooltip-padding|var(--size-4-2) var(--size-4-3)|8px 12px|text|2709',
  '--tooltip-max-width|300px|300px|text|2710',
  '--tooltip-radius|var(--radius-l)|12px|text|2711',
  '--search-input-radius|100px|100px|text|3107',
  '--search-input-corner-shape|round|round|text|3108',
  '--search-icon-size|16px|16px|text|2681',
  '--radius-xl|24px|24px|text|2652',
  '--nav-item-radius|var(--radius-m)|8px|text|2489',
  '--scroll-mask-small|linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px)|linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px)|text|2676',
  '--toggle-thumb-opacity-active|0.6|0.6|text|3121',
  '--tab-inner-background|transparent|rgba(0, 0, 0, 0)|color|2790|0,0,0,0',
  '--tab-inner-background-hover|var(--background-modifier-hover)|rgba(0, 0, 0, 0.067)|color|2791|0,0,0,0.067',
  '--tab-inner-background-active|transparent|rgba(0, 0, 0, 0)|color|2792|0,0,0,0',
  '--tab-inner-border-width|0px|0px|text|2793',
  '--tab-inner-border-color|transparent|rgba(0, 0, 0, 0)|color|2794|0,0,0,0',
  '--tab-container-padding-start|var(--size-4-2)|8px|text|2806',
  '--tab-container-padding-end|var(--size-4-2)|8px|text|2807',
  '--tab-outline-color-hover|transparent|rgba(0, 0, 0, 0)|color|2810|0,0,0,0',
  '--image-radius|4px|4px|text|2402',
].reduce((m,row)=>{const p=row.split('|');m[p[0]]={raw:p[1],value:p[2],kind:p[3],line:+p[4],rgba:p[5]?p[5].split(',').map(Number):undefined};return m;},{}),
dark:[
  '--h1-weight|700|700|text|2002','--h2-weight|600|680|text|2003',
  '--h3-weight|600|660|text|2004','--h4-weight|600|640|text|2005',
  '--h5-weight|600|620|text|2006','--h6-weight|600|600|text|2007',
  '--blockquote-border-thickness|2px|2px|text|2103','--blockquote-border-color|var(--interactive-accent)|#8a5cf5|color|2104|138,92,245,1',
  '--blockquote-font-style|normal|normal|text|2105','--blockquote-color|inherit||text|2106',
  '--blockquote-background-color|transparent|rgba(0, 0, 0, 0)|color|2107|0,0,0,0','--bold-color|inherit||text|2110',
  '--bold-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2111','--callout-border-width|0px|0px|text|2131',
  '--callout-border-opacity|0.25|0.25|text|2132','--callout-radius|var(--radius-s)|4px|text|2134',
  '--callout-blend-mode|var(--highlight-mix-blend-mode)|lighten|text|2135','--callout-title-weight|calc(var(--font-weight) + var(--bold-modifier))|calc(400 + 200)|text|2139',
  '--callout-bug|var(--color-red)|251, 70, 76|text|2142','--callout-default|var(--color-blue)|2, 122, 255|text|2143',
  '--callout-error|var(--color-red)|251, 70, 76|text|2144','--callout-example|var(--color-purple)|168, 130, 255|text|2145',
  '--callout-fail|var(--color-red)|251, 70, 76|text|2146','--callout-important|var(--color-cyan)|83, 223, 221|text|2147',
  '--callout-info|var(--color-blue)|2, 122, 255|text|2148','--callout-question|var(--color-orange)|233, 151, 63|text|2149',
  '--callout-success|var(--color-green)|68, 207, 110|text|2150','--callout-summary|var(--color-cyan)|83, 223, 221|text|2151',
  '--callout-tip|var(--color-cyan)|83, 223, 221|text|2152','--callout-todo|var(--color-blue)|2, 122, 255|text|2153',
  '--callout-warning|var(--color-orange)|233, 151, 63|text|2154','--callout-quote|#9e9e9e|158, 158, 158|text|2155',
  '--canvas-background|var(--background-primary)|#1c1c1c|color|2157|28,28,28,1','--canvas-card-label-color|var(--text-faint)|#666666|color|2158|102,102,102,1',
  '--canvas-color-1|var(--color-red)|251, 70, 76|text|2159','--canvas-color-2|var(--color-orange)|233, 151, 63|text|2160',
  '--canvas-color-3|var(--color-yellow)|224, 222, 113|text|2161','--canvas-color-4|var(--color-green)|68, 207, 110|text|2162',
  '--canvas-color-5|var(--color-cyan)|83, 223, 221|text|2163','--canvas-color-6|var(--color-purple)|168, 130, 255|text|2164',
  '--canvas-dot-pattern|var(--color-base-30)|#333333|color|2168|51,51,51,1','--caret-color|var(--text-normal)|#dadada|color|2170|218,218,218,1',
  '--checkbox-radius|var(--radius-s)|4px|text|2172','--checkbox-size|var(--font-preferred-size)|16px|text|2173',
  '--checkbox-marker-color|var(--background-primary)|#1c1c1c|color|2174|28,28,28,1','--checkbox-color|var(--interactive-accent)|#8a5cf5|color|2175|138,92,245,1',
  '--checkbox-color-hover|var(--interactive-accent-hover)|#a68af9|color|2176|166,138,249,1','--checkbox-border-color|var(--text-faint)|#666666|color|2177|102,102,102,1',
  '--checkbox-border-color-hover|var(--text-muted)|#b3b3b3|color|2178|179,179,179,1','--code-white-space|pre-wrap|pre-wrap|text|2183',
  '--code-radius|var(--radius-s)|4px|text|2187','--code-size|var(--font-smaller)|0.875em|text|2188',
  '--code-background|var(--background-primary-alt)|#232323|color|2189|35,35,35,1','--code-normal|var(--text-normal)|#dadada|color|2190|218,218,218,1',
  '--code-comment|var(--text-faint)|#666666|color|2191|102,102,102,1','--code-function|var(--color-yellow)|#e0de71|color|2192|224,222,113,1',
  '--code-important|var(--color-orange)|#e9973f|color|2193|233,151,63,1','--code-keyword|var(--color-pink)|#fa99cd|color|2194|250,153,205,1',
  '--code-operator|var(--color-red)|#fb464c|color|2195|251,70,76,1','--code-property|var(--color-cyan)|#53dfdd|color|2196|83,223,221,1',
  '--code-punctuation|var(--text-muted)|#b3b3b3|color|2197|179,179,179,1','--code-string|var(--color-green)|#44cf6e|color|2198|68,207,110,1',
  '--code-tag|var(--color-red)|#fb464c|color|2199|251,70,76,1','--code-value|var(--color-purple)|#a882ff|color|2200|168,130,255,1',
  '--collapse-icon-color|var(--text-faint)|#666666|color|2202|102,102,102,1','--collapse-icon-color-collapsed|var(--text-accent)|#a68af9|color|2203|166,138,249,1',
  '--cursor|default|default|text|2205','--cursor-link|pointer|pointer|text|2206',
  '--divider-color|var(--background-modifier-border)|#333333|color|2212|51,51,51,1','--divider-color-hover|var(--interactive-accent)|#8a5cf5|color|2213|138,92,245,1',
  '--divider-width|1px|1px|text|2214','--divider-width-hover|3px|3px|text|2215',
  '--embed-background|inherit||text|2239','--embed-border-start|2px solid var(--interactive-accent)|2px solid hsl(258, 88%, 66%)|text|2240',
  '--embed-padding|0 0 0 var(--size-4-6)|0 0 0 24px|text|2244','--embed-font-style|inherit||text|2245',
  '--file-line-width|700px|700px|text|2257','--file-folding-offset|24px|24px|text|2258',
  '--file-margins|var(--file-margins-y) var(--file-margins-x)|32px 32px|text|2259','--font-smallest|0.8em|0.8em|text|2271',
  '--font-smaller|0.875em|0.875em|text|2272','--font-small|0.933em|0.933em|text|2273',
  '--font-ui-smaller|12px|12px|text|2278','--font-ui-small|13px|13px|text|2279',
  '--font-ui-medium|15px|15px|text|2280','--font-ui-large|20px|20px|text|2281',
  '--font-weight|var(--font-normal)|400|text|2283','--font-thin|100|100|text|2284',
  '--font-extralight|200|200|text|2285','--font-light|300|300|text|2286',
  '--font-normal|400|400|text|2287','--font-medium|500|500|text|2288',
  '--font-semibold|600|600|text|2289','--font-bold|700|700|text|2290',
  '--font-extrabold|800|800|text|2291','--font-black|900|900|text|2292',
  '--graph-controls-width|240px|240px|text|2309','--graph-text|var(--text-normal)|#dadada|color|2310|218,218,218,1',
  '--graph-line|var(--color-base-35, var(--background-modifier-border-focus))|#3f3f3f|color|2311|63,63,63,1','--graph-node|var(--text-muted)|#b3b3b3|color|2312|179,179,179,1',
  '--graph-node-unresolved|var(--text-faint)|#666666|color|2313|102,102,102,1','--graph-node-focused|var(--text-accent)|#a68af9|color|2314|166,138,249,1',
  '--graph-node-tag|var(--color-green)|#44cf6e|color|2315|68,207,110,1','--graph-node-attachment|var(--color-yellow)|#e0de71|color|2316|224,222,113,1',
  '--heading-spacing|calc(var(--p-spacing) * 2.5)|calc(1rem * 2.5)|text|2319','--h1-letter-spacing|-0.015em|-0.015em|text|2332',
  '--h2-letter-spacing|-0.011em|-0.011em|text|2333','--h3-letter-spacing|-0.008em|-0.008em|text|2334',
  '--h4-letter-spacing|-0.005em|-0.005em|text|2335','--h5-letter-spacing|-0.002em|-0.002em|text|2336',
  '--h6-letter-spacing|0em|0em|text|2337','--h1-line-height|1.2|1.2|text|2338',
  '--h2-line-height|1.2|1.2|text|2339','--h3-line-height|1.3|1.3|text|2340',
  '--h4-line-height|1.4|1.4|text|2341','--h5-line-height|var(--line-height-normal)|1.5|text|2342',
  '--h6-line-height|var(--line-height-normal)|1.5|text|2343','--h1-size|1.618em|1.618em|text|2344',
  '--h2-size|1.462em|1.462em|text|2345','--h3-size|1.318em|1.318em|text|2346',
  '--h4-size|1.188em|1.188em|text|2347','--h5-size|1.076em|1.076em|text|2348',
  '--h6-size|1em|1em|text|2349','--hr-color|var(--background-modifier-border)|#333333|color|2369|51,51,51,1',
  '--hr-thickness|2px|2px|text|2370','--icon-size|var(--icon-m)|16px|text|2381',
  '--icon-color|var(--text-muted)|#b3b3b3|color|2393|179,179,179,1','--icon-color-hover|var(--text-muted)|#b3b3b3|color|2394|179,179,179,1',
  '--icon-color-active|var(--text-accent)|#a68af9|color|2395|166,138,249,1','--icon-opacity|0.85|0.85|text|2397',
  '--indentation-guide-width|var(--border-width)|1px|text|2407','--indentation-guide-color|color-mix(in oklch, var(--mono-100) 12%, transparent)|rgba(255, 255, 255, 0.12)|color|2409|255,255,255,0.12',
  '--indentation-guide-color-active|color-mix(in oklch, var(--mono-100) 30%, transparent)|rgba(255, 255, 255, 0.3)|color|2410|255,255,255,0.3','--inline-title-size|var(--h1-size)|1.618em|text|2418',
  '--inline-title-weight|var(--h1-weight)|700|text|2421','--input-height|30px|30px|text|2424',
  '--input-radius|var(--radius-m)|8px|text|3099','--input-border-width|var(--border-width)|1px|text|2429',
  '--input-placeholder-color|var(--text-faint)|#666666|color|2431|102,102,102,1','--italic-color|inherit||text|2436',
  '--italic-weight|inherit||text|2437','--layer-popover|30|30|text|2442',
  '--layer-modal|50|50|text|2444','--layer-notice|60|60|text|2445',
  '--layer-menu|65|65|text|2446','--layer-tooltip|70|70|text|2447',
  '--line-height-normal|1.5|1.5|text|2454','--line-height-tight|1.3|1.3|text|2455',
  '--link-color|var(--text-accent)|#a68af9|color|2457|166,138,249,1','--link-color-hover|var(--text-accent-hover)|#c5b6fc|color|2458|197,182,252,1',
  '--link-decoration|underline|underline|text|2459','--link-decoration-hover|underline|underline|text|2460',
  '--link-decoration-thickness|auto|auto|text|2461','--link-weight|var(--font-weight)|400|text|2462',
  '--link-external-color|var(--text-accent)|#a68af9|color|2463|166,138,249,1','--link-external-color-hover|var(--text-accent-hover)|#c5b6fc|color|2464|197,182,252,1',
  '--link-external-decoration|underline|underline|text|2465','--link-external-decoration-hover|underline|underline|text|2466',
  '--link-external-filter|none|none|text|2467','--link-unresolved-color|var(--text-accent)|#a68af9|color|2468|166,138,249,1',
  '--link-unresolved-opacity|0.7|0.7|text|2469','--link-unresolved-filter|none|none|text|2470',
  '--link-unresolved-decoration-style|solid|solid|text|2471','--link-unresolved-decoration-color|color-mix(in oklch, var(--interactive-accent) 30%, transparent)|rgba(138, 92, 245, 0.3)|color|2472|138,92,245,0.3',
  '--list-indent|calc(var(--indent-unit) * var(--indent-size))|calc(0.5625em * 4)|text|2474','--list-marker-color|var(--text-faint)|#666666|color|2478|102,102,102,1',
  '--list-marker-color-hover|var(--text-muted)|#b3b3b3|color|2479|179,179,179,1','--nav-item-size|var(--font-ui-small)|13px|text|2488',
  '--nav-item-color|var(--text-muted)|#b3b3b3|color|2490|179,179,179,1','--nav-item-color-hover|var(--text-normal)|#dadada|color|2491|218,218,218,1',
  '--nav-item-color-active|var(--text-normal)|#dadada|color|2492|218,218,218,1','--nav-item-background-hover|var(--background-modifier-hover)|rgba(255, 255, 255, 0.067)|color|2495|255,255,255,0.067',
  '--nav-item-background-selected|color-mix(in oklch, var(--color-accent) 15%, transparent)|rgba(138, 92, 245, 0.15)|color|2497|138,92,245,0.15','--menu-background|var(--background-secondary)|#282828|color|2540|40,40,40,1',
  '--metadata-background|transparent|rgba(0, 0, 0, 0)|color|2546|0,0,0,0','--metadata-divider-color|var(--background-modifier-border)|#333333|color|2554|51,51,51,1',
  '--metadata-property-background-active|var(--background-modifier-hover)|rgba(255, 255, 255, 0.067)|color|2568|255,255,255,0.067','--metadata-label-text-color|var(--text-muted)|#b3b3b3|color|2577|179,179,179,1',
  '--metadata-input-text-color|var(--text-normal)|#dadada|color|2581|218,218,218,1','--modal-background|var(--background-primary)|#1c1c1c|color|2592|28,28,28,1',
  '--modal-width|90vw|90vw|text|2594','--modal-max-width|1100px|1100px|text|2597',
  '--modal-border-width|var(--border-width)|1px|text|2601','--modal-border-color|var(--background-modifier-border-hover)|#3f3f3f|color|2602|63,63,63,1',
  '--modal-radius|var(--radius-xl)|24px|text|3105','--modal-community-sidebar-width|280px|280px|text|2604',
  '--pill-color|var(--text-muted)|#b3b3b3|color|2606|179,179,179,1','--pill-background|transparent|rgba(0, 0, 0, 0)|color|2612|0,0,0,0',
  '--pill-border-color|var(--background-modifier-border)|#333333|color|2614|51,51,51,1','--pill-padding-x|0.65em|0.65em|text|2617',
  '--pill-radius|2em|2em|text|2619','--prompt-background|var(--background-primary)|#1c1c1c|color|2639|28,28,28,1',
  '--prompt-input-height|40px|40px|text|2641','--prompt-width|700px|700px|text|2642',
  '--prompt-max-width|80vw|80vw|text|2643','--prompt-border-width|var(--border-width)|1px|text|2645',
  '--prompt-border-color|var(--background-modifier-border-hover)|#3f3f3f|color|2646|63,63,63,1','--ribbon-background|var(--background-secondary)|#282828|color|2663|40,40,40,1',
  '--ribbon-background-collapsed|var(--background-primary)|#1c1c1c|color|2664|28,28,28,1','--ribbon-width|44px|44px|text|2665',
  '--ribbon-padding|var(--size-4-2) var(--size-4-1) var(--size-4-3)|8px 4px 12px|text|2666','--scrollbar-width|12px|12px|text|2668',
  '--scrollbar-height|12px|12px|text|2669','--scrollbar-border-width|3px 3px 3px 2px|3px 3px 3px 2px|text|2670',
  '--scrollbar-radius|var(--radius-l)|12px|text|2671','--scrollbar-active-thumb-bg|color-mix(in oklch, var(--mono-100) 20%, transparent)|rgba(255, 255, 255, 0.2)|color|2672|255,255,255,0.2',
  '--scrollbar-bg|transparent|rgba(0, 0, 0, 0)|color|2673|0,0,0,0','--scrollbar-thumb-bg|gray|#808080|color|3106|128,128,128,1',
  '--status-bar-background|var(--background-secondary)|#282828|color|2761|40,40,40,1','--status-bar-border-color|var(--divider-color)|#333333|color|2762|51,51,51,1',
  '--status-bar-border-width|var(--border-width) 0 0 var(--border-width)|1px 0 0 1px|text|2763','--status-bar-font-size|var(--font-ui-smaller)|12px|text|2764',
  '--status-bar-text-color|var(--text-muted)|#b3b3b3|color|2765|179,179,179,1','--status-bar-position|fixed|fixed|text|2766',
  '--status-bar-radius|var(--radius-m) 0 0 0|8px 0 0 0|text|2767','--tab-background-active|var(--background-primary)|#1c1c1c|color|2789|28,28,28,1',
  '--tab-text-color|var(--text-faint)|#666666|color|2797|102,102,102,1','--tab-text-color-active|var(--text-muted)|#b3b3b3|color|2798|179,179,179,1',
  '--tab-text-color-focused|var(--text-muted)|#b3b3b3|color|2799|179,179,179,1','--tab-text-color-focused-active|var(--text-muted)|#b3b3b3|color|2800|179,179,179,1',
  '--tab-text-color-focused-highlighted|var(--text-accent)|#a68af9|color|2801|166,138,249,1','--tab-text-color-focused-active-current|var(--text-normal)|#dadada|color|2802|218,218,218,1',
  '--tab-font-size|var(--font-ui-small)|13px|text|2803','--tab-font-weight|inherit||text|2804',
  '--tab-container-background|var(--background-secondary)|#282828|color|2805|40,40,40,1','--tab-divider-color|var(--background-modifier-border-hover)|#3f3f3f|color|2808|63,63,63,1',
  '--tab-outline-color|var(--divider-color)|#333333|color|2809|51,51,51,1','--tab-outline-width|1px|1px|text|2811',
  '--tab-curve|10px|10px|text|2813','--tab-radius|var(--radius-m)|8px|text|3115',
  '--tab-radius-active|10px 10px 0 0|10px 10px 0 0|text|2815','--tab-width|200px|200px|text|2816',
  '--tab-max-width|320px|320px|text|2817','--tab-switcher-background|var(--background-secondary)|#282828|color|2820|40,40,40,1',
  '--tab-stacked-pane-width|700px|700px|text|2827','--tab-stacked-header-width|var(--header-height)|40px|text|2828',
  '--tab-stacked-shadow|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|-8px 0 8px 0 rgba(0, 0, 0, 0.05)|text|2834','--table-background|transparent|rgba(0, 0, 0, 0)|color|2836|0,0,0,0',
  '--table-border-color|var(--background-modifier-border)|#333333|color|2838|51,51,51,1','--table-header-background|var(--table-background)|rgba(0, 0, 0, 0)|color|2840|0,0,0,0',
  '--table-header-color|var(--text-normal)|#dadada|color|2847|218,218,218,1','--table-row-background-hover|var(--table-background)|rgba(0, 0, 0, 0)|color|2856|0,0,0,0',
  '--tag-size|var(--font-smaller)|0.875em|text|2875','--tag-color|var(--text-accent)|#a68af9|color|2876|166,138,249,1',
  '--tag-color-hover|var(--text-accent)|#a68af9|color|2877|166,138,249,1','--tag-background|color-mix(in oklch, var(--interactive-accent) 10%, transparent)|rgba(138, 92, 245, 0.1)|color|2880|138,92,245,0.1',
  '--tag-background-hover|color-mix(in oklch, var(--interactive-accent) 20%, transparent)|rgba(138, 92, 245, 0.2)|color|2881|138,92,245,0.2','--tag-border-color|color-mix(in oklch, var(--interactive-accent) 15%, transparent)|rgba(138, 92, 245, 0.15)|color|2882|138,92,245,0.15',
  '--tag-border-color-hover|color-mix(in oklch, var(--interactive-accent) 15%, transparent)|rgba(138, 92, 245, 0.15)|color|2883|138,92,245,0.15','--tag-padding-x|0.65em|0.65em|text|2885',
  '--tag-radius|2em|2em|text|2887','--titlebar-background|var(--background-secondary)|#282828|color|2893|40,40,40,1',
  '--titlebar-background-focused|var(--background-secondary)|#282828|color|2894|40,40,40,1','--titlebar-border-width|0px|0px|text|2895',
  '--titlebar-border-color|var(--background-modifier-border)|#333333|color|2896|51,51,51,1','--titlebar-text-color|var(--text-muted)|#b3b3b3|color|2897|179,179,179,1',
  '--titlebar-text-color-focused|var(--text-normal)|#dadada|color|2898|218,218,218,1','--titlebar-text-weight|var(--font-bold)|700|text|2899',
  '--vault-profile-color|var(--text-normal)|#dadada|color|2932|218,218,218,1','--vault-profile-color-hover|var(--vault-profile-color)|#dadada|color|2933|218,218,218,1',
  '--workspace-background-translucent|color-mix(in oklch, var(--mono-0) 60%, transparent)|rgba(0, 0, 0, 0.6)|color|2936|0,0,0,0.6','--accent-h|258|258|text|2939',
  '--accent-s|88%|88%|text|2940','--accent-l|66%|66%|text|2941',
  '--background-primary|var(--color-base-00)|#1c1c1c|color|2943|28,28,28,1','--background-primary-alt|var(--color-base-10)|#232323|color|2944|35,35,35,1',
  '--background-secondary|var(--color-base-20)|#282828|color|2945|40,40,40,1','--background-modifier-hover|color-mix(in oklch, var(--mono-100) 6.7%, transparent)|rgba(255, 255, 255, 0.067)|color|2946|255,255,255,0.067',
  '--background-modifier-border|var(--color-base-30)|#333333|color|2948|51,51,51,1','--background-modifier-border-hover|var(--color-base-35)|#3f3f3f|color|2949|63,63,63,1',
  '--background-modifier-border-focus|var(--color-base-40)|#555555|color|2950|85,85,85,1','--background-modifier-error|var(--color-red)|#fb464c|color|2951|251,70,76,1',
  '--background-modifier-success|var(--color-green)|#44cf6e|color|2955|68,207,110,1','--background-modifier-message|color-mix(in oklch, black 90%, transparent)|rgba(0, 0, 0, 0.9)|color|2956|0,0,0,0.9',
  '--background-modifier-form-field|var(--color-base-25)|#2e2e2e|color|3065|46,46,46,1','--text-normal|var(--color-base-100)|#dadada|color|2961|218,218,218,1',
  '--text-muted|var(--color-base-70)|#b3b3b3|color|2962|179,179,179,1','--text-faint|var(--color-base-50)|#666666|color|2963|102,102,102,1',
  '--text-on-accent|white|#ffffff|color|2964|255,255,255,1','--text-error|var(--color-red)|#fb464c|color|2966|251,70,76,1',
  '--text-warning|var(--color-orange)|#e9973f|color|2967|233,151,63,1','--text-success|var(--color-green)|#44cf6e|color|2968|68,207,110,1',
  '--text-selection|color-mix(in oklch, var(--interactive-accent) 33%, transparent)|rgba(138, 92, 245, 0.33)|color|3075|138,92,245,0.33','--text-highlight-bg|rgba(var(--text-highlight-bg-rgb), 0.4)|rgba(255, 208, 0, 0.4)|color|2852|255,208,0,0.4',
  '--text-accent|var(--color-accent-1)|#a68af9|color|3069|166,138,249,1','--text-accent-hover|var(--color-accent-2)|#c5b6fc|color|2971|197,182,252,1',
  '--interactive-normal|var(--background-modifier-border)|#333333|color|3103|51,51,51,1','--interactive-hover|var(--background-modifier-border)|#333333|color|3104|51,51,51,1',
  '--interactive-accent|var(--color-accent)|#8a5cf5|color|3070|138,92,245,1','--interactive-accent-hover|var(--color-accent-1)|#a68af9|color|3071|166,138,249,1',
  '--dropdown-background|var(--interactive-normal)|#333333|color|2223|51,51,51,1','--dropdown-background-hover|var(--interactive-hover)|#333333|color|2224|51,51,51,1',
  '--highlight-mix-blend-mode|lighten|lighten|text|3033','--mono-rgb-0|0, 0, 0|0, 0, 0|text|3084',
  '--mono-rgb-100|255, 255, 255|255, 255, 255|text|3085','--color-red-rgb|251, 70, 76|251, 70, 76|text|3087',
  '--color-red|#fb464c|#fb464c|color|3036|251,70,76,1','--color-orange-rgb|233, 151, 63|233, 151, 63|text|3088',
  '--color-orange|#e9973f|#e9973f|color|3037|233,151,63,1','--color-yellow-rgb|224, 222, 113|224, 222, 113|text|3089',
  '--color-yellow|#e0de71|#e0de71|color|3038|224,222,113,1','--color-green-rgb|68, 207, 110|68, 207, 110|text|3090',
  '--color-green|#44cf6e|#44cf6e|color|3039|68,207,110,1','--color-cyan-rgb|83, 223, 221|83, 223, 221|text|3091',
  '--color-cyan|#53dfdd|#53dfdd|color|3040|83,223,221,1','--color-blue-rgb|2, 122, 255|2, 122, 255|text|3092',
  '--color-blue|#027aff|#027aff|color|3041|2,122,255,1','--color-purple-rgb|168, 130, 255|168, 130, 255|text|3093',
  '--color-purple|#a882ff|#a882ff|color|3042|168,130,255,1','--color-pink-rgb|250, 153, 205|250, 153, 205|text|3094',
  '--color-pink|#fa99cd|#fa99cd|color|3043|250,153,205,1','--color-base-00|#1C1C1C|#1c1c1c|color|3044|28,28,28,1',
  '--color-base-05|#212121|#212121|color|3045|33,33,33,1','--color-base-10|#232323|#232323|color|3046|35,35,35,1',
  '--color-base-20|#282828|#282828|color|3047|40,40,40,1','--color-base-25|#2e2e2e|#2e2e2e|color|3048|46,46,46,1',
  '--color-base-30|#333333|#333333|color|3049|51,51,51,1','--color-base-35|#3f3f3f|#3f3f3f|color|3050|63,63,63,1',
  '--color-base-40|#555555|#555555|color|3051|85,85,85,1','--color-base-50|#666666|#666666|color|3052|102,102,102,1',
  '--color-base-60|#999999|#999999|color|3053|153,153,153,1','--color-base-70|#b3b3b3|#b3b3b3|color|3054|179,179,179,1',
  '--color-base-100|#dadada|#dadada|color|3055|218,218,218,1','--color-accent|hsl(var(--accent-h), var(--accent-s), var(--accent-l))|#8a5cf5|color|3056|138,92,245,1',
  '--color-accent-1|hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15))|#a68af9|color|3057|166,138,249,1','--color-accent-2|hsl(calc(var(--accent-h) - 5), calc(var(--accent-s) * 1.05), calc(var(--accent-l) * 1.29))|#c5b6fc|color|3058|197,182,252,1',
  '--background-secondary-alt|var(--color-base-30)|#333333|color|3066|51,51,51,1','--background-modifier-cover|rgba(10, 10, 10, 0.4)|rgba(10, 10, 10, 0.4)|color|3073|10,10,10,0.4',
  '--input-shadow|none|none|text|3101','--input-shadow-hover|none|none|text|3102',
  '--shadow-s|0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3)|0px 1px 2px rgba(0, 0, 0, 0.121), 0px 3.4px 6.7px rgba(0, 0, 0, 0.179), 0px 15px 30px rgba(0, 0, 0, 0.3)|text|3079','--shadow-l|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 30px 90px rgba(0, 0, 0, 0.2)|0px 1.8px 7.3px rgba(0, 0, 0, 0.071), 0px 6.3px 24.7px rgba(0, 0, 0, 0.112), 0px 30px 90px rgba(0, 0, 0, 0.2)|text|3080',
  '--slider-thumb-width|30px|30px|text|3110','--toggle-width|44px|44px|text|3116',
  '--toggle-radius|24px|24px|text|3117','--toggle-thumb-height|16px|16px|text|3119',
  '--toggle-thumb-width|26px|26px|text|3120','--font-text-size|16px|16px|text|3200',
  '--zoom-factor|1|1|text|4293','--titlebar-height|30px|30px|text|4294',
  '--font-preferred-size|var(--font-text-size)|16px|text|3201',
  '--mono-0|black|#000000|color|3034|0,0,0,1',
  '--mono-100|white|#ffffff|color|3035|255,255,255,1',
  '--modal-sidebar-background|var(--modal-background)|#1c1c1c|color|2593|28,28,28,1',
  '--settings-background|var(--modal-background)|#1c1c1c|color|2686|28,28,28,1',
  '--setting-items-padding-x|var(--size-4-5)|20px|text|2692',
  '--setting-items-padding-y|var(--size-4-5)|20px|text|2693',
  '--setting-item-name-color|var(--text-normal)|#dadada|color|2699|218,218,218,1',
  '--setting-item-name-size|var(--font-ui-small)|13px|text|2700',
  '--setting-item-name-weight|var(--font-normal)|400|text|2701',
  '--tooltip-background|var(--background-modifier-message)|rgba(0, 0, 0, 0.9)|color|2704|0,0,0,0.9',
  '--tooltip-color|#FAFAFA|#fafafa|color|2705|250,250,250,1',
  '--tooltip-font-size|var(--font-ui-small)|13px|text|2706',
  '--tooltip-font-weight|var(--font-normal)|400|text|2707',
  '--tooltip-line-height|var(--line-height-tight)|1.3|text|2708',
  '--tooltip-padding|var(--size-4-2) var(--size-4-3)|8px 12px|text|2709',
  '--tooltip-max-width|300px|300px|text|2710',
  '--tooltip-radius|var(--radius-l)|12px|text|2711',
  '--search-input-radius|100px|100px|text|3107',
  '--search-input-corner-shape|round|round|text|3108',
  '--search-icon-size|16px|16px|text|2681',
  '--radius-xl|24px|24px|text|2652',
  '--nav-item-radius|var(--radius-m)|8px|text|2489',
  '--scroll-mask-small|linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px)|linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 24px)|text|2676',
  '--toggle-thumb-opacity-active|0.6|0.6|text|3121',
  '--tab-inner-background|transparent|rgba(0, 0, 0, 0)|color|2790|0,0,0,0',
  '--tab-inner-background-hover|var(--background-modifier-hover)|rgba(255, 255, 255, 0.067)|color|2791|255,255,255,0.067',
  '--tab-inner-background-active|transparent|rgba(0, 0, 0, 0)|color|2792|0,0,0,0',
  '--tab-inner-border-width|0px|0px|text|2793',
  '--tab-inner-border-color|transparent|rgba(0, 0, 0, 0)|color|2794|0,0,0,0',
  '--tab-container-padding-start|var(--size-4-2)|8px|text|2806',
  '--tab-container-padding-end|var(--size-4-2)|8px|text|2807',
  '--tab-outline-color-hover|transparent|rgba(0, 0, 0, 0)|color|2810|0,0,0,0',
  '--image-radius|4px|4px|text|2402',
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
/* 1.14.4 的 color-mix(in oklch, …) 在 Chromium 计算值里序列化为 oklch()；
   旧版 rgba() 解析器需要同时支持 oklch()/color(srgb …)，统一折算为 sRGB 0-255。 */
const oklchToRgb=(L,C,h,a)=>{
  const rad=(h==='none'?0:h)*Math.PI/180,A=C*Math.cos(rad),B=C*Math.sin(rad);
  const l_=L+0.3963377774*A+0.2158037573*B,m_=L-0.1055613458*A-0.0638541728*B,s_=L-0.0894841775*A-1.2914855480*B;
  const l=l_**3,m=m_**3,s=s_**3;
  const lin=[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];
  const gam=v=>Math.min(1,Math.max(0,v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055));
  return [Math.round(gam(lin[0])*255),Math.round(gam(lin[1])*255),Math.round(gam(lin[2])*255),a];
};
const parseRgb=text=>{
  const s=norm(text);
  let m=s.match(/^rgba?\(([^)]+)\)$/);
  if(m){const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);if(p.length<3||p.some(n=>Number.isNaN(n)))return null;return [p[0],p[1],p[2],p.length>3?p[3]:1];}
  m=s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+|none)\s*(?:\/\s*([\d.]+)(%)?)?\s*\)$/);
  if(m){const L=parseFloat(m[1])/(m[2]?100:1);const C=parseFloat(m[3])/(m[4]?100/0.4:1);const a=m[6]===undefined?1:parseFloat(m[6])/(m[7]?100:1);return oklchToRgb(L,C,m[5],a);}
  m=s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if(m)return [parseFloat(m[1])*255,parseFloat(m[2])*255,parseFloat(m[3])*255,m[4]===undefined?1:parseFloat(m[4])];
  return null;
};
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
    check(shadowEdges===''&&shadowXs==='','深色下 --shadow-edges/--shadow-xs 与 app.css 一致地失效（app.css:3014 仅浅色定义）');
  }else{
    check(shadowEdges==='0 0 transparent'&&/^0 1px 6px/.test(shadowXs),'浅色下 --shadow-edges/--shadow-xs 有值（app.css:3014-3015）');
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
check(back==='#1C1C1C','直接切 theme-dark 后 --background-primary = '+back+'，期望 #1C1C1C');

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

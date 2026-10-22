/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例（run.mjs 已设 E2E=1）。
 * [OUTPUT]: 触摸板缩放锁与"快速调整字体大小"语义断言；失败抛出异常，供运行器判定。
 * [POS]: zoom-lock 场景。钉住：默认捏合/Ctrl+滚轮不改字号且默认行为被吞、开启后 ±1 与上下限、非 ctrl 滚轮不动、视觉缩放恒 1（整页缩放锁）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,m)=>{if(!ok)throw Error('✗ '+m);checks.push(m);};
const wheel=(dy,ctrl=true)=>{const ev=new WheelEvent('wheel',{deltaY:dy,ctrlKey:ctrl,bubbles:true,cancelable:true});return window.dispatchEvent(ev);};

// 1) 默认：不得改字号，且默认行为被吞（不出整页缩放/滚动）
check(app.settings.config.baseFontSizeAction===false,'默认关闭"快速调整字体大小"');
const base0=app.settings.config.baseFontSize||16;
check(wheel(-120)===false,'默认捏合被 preventDefault');
check(app.settings.config.baseFontSize===base0,'默认捏合不改字号 :: '+app.settings.config.baseFontSize+'/'+base0);

// 2) 开启后：上滚 +1 / 下滚 -1
app.settings.updateAppearance({baseFontSizeAction:true});
wheel(-120);
check(app.settings.config.baseFontSize===base0+1,'开启后上滚 +1 :: '+app.settings.config.baseFontSize);
wheel(120);
check(app.settings.config.baseFontSize===base0,'开启后下滚 -1 :: '+app.settings.config.baseFontSize);

// 3) 上下限
app.settings.updateAppearance({baseFontSize:30});
wheel(-120);
check(app.settings.config.baseFontSize===30,'上限 30 不越界');
app.settings.updateAppearance({baseFontSize:10});
wheel(120);
check(app.settings.config.baseFontSize===10,'下限 10 不越界');

// 4) 非 ctrl 滚轮不动字号
app.settings.updateAppearance({baseFontSize:base0});
wheel(120,false);
check(app.settings.config.baseFontSize===base0,'普通滚轮不改字号');

// 5) 视觉缩放锁：整页缩放恒 1
const electron=require('electron');
check(!electron||!electron.webFrame||electron.webFrame.getZoomFactor()===1,'webFrame zoomFactor 恒 1');
check(!window.visualViewport||window.visualViewport.scale===1,'visualViewport.scale 恒 1');
check(document.body.style.zoom===''||document.body.style.zoom==='1','body zoom 未被改写');

// 6) 复位
app.settings.updateAppearance({baseFontSizeAction:false});
app.settings.updateAppearance({baseFontSize:base0});
return {pass:true,count:checks.length,checks};
})()

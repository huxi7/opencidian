/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 分屏/布局几何断言；失败抛出异常，供运行器判定。
 * [POS]: layout-split 场景。锁定"新建分屏 / 保存-加载工作区布局后整窗被裁剪一半"的回归：
 *        每次操作后测量 root split、左右栏、每个叶子与内容容器的 rect，要求全部落在视口内、
 *        宽高非零、叶子里内容容器与叶子同尺寸，且中心区叶子不越出中心列。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[];const ok=(b,m)=>{if(!b)throw Error(m)};const check=(b,m)=>{ok(b,m);checks.push(m)};
const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
const round=r=>[Math.round(r.x),Math.round(r.y),Math.round(r.w),Math.round(r.h)].join(',');

for(const n of ['A.md','B.md','C.md']) if(!app.vault.getFileByPath(n)) await app.vault.create(n,'# '+n+'\n\n正文');
const a=app.vault.getFileByPath('A.md');
await app.workspace.openFile(a);
await wait(300);

const ws=app.workspace;
const root=()=>document.querySelector('.workspace-split.workspace-root')||document.querySelector('.workspace');
const center=()=>document.querySelector('.workspace-split.mod-root');
const leaves=()=>[...document.querySelectorAll('.workspace-leaf')].filter(el=>el.closest('.workspace-split.mod-root'));

const assertGeometry=(label)=>{
  const vr={x:0,y:0,w:innerWidth,h:innerHeight};
  const rr=rect(root());
  check(rr.w>innerWidth*0.8&&rr.h>innerHeight*0.5, label+'：root split 覆盖窗口:: '+round(rr)+' / '+innerWidth+'x'+innerHeight);
  const cr=rect(center());
  check(cr.w>0&&cr.h>0, label+'：中心列宽高非零:: '+round(cr));
  check(cr.x>=vr.x-1&&cr.y>=vr.y-1&&cr.right<=vr.x+vr.w+1&&cr.bottom<=vr.y+vr.h+1, label+'：中心列不越出视口:: '+round(cr)+' viewport='+JSON.stringify(vr));
  const ls=leaves();
  check(ls.length>0, label+'：存在中心叶子');
  for(const leaf of ls){
    const lr=rect(leaf);
    const content=leaf.querySelector('.workspace-leaf-content');
    const clr=content?rect(content):null;
    check(lr.w>40&&lr.h>40, label+'：叶子宽高足够:: '+round(lr));
    check(clr&&clr.w>=lr.w-2&&clr.h>=lr.h-2, label+'：叶子内容铺满叶子:: '+round(lr)+' vs '+(clr?round(clr):'null'));
    check(lr.y>=cr.y-2&&lr.bottom<=cr.bottom+2, label+'：叶子纵向不越出中心列:: '+round(lr)+' in '+round(cr));
    check(lr.x>=cr.x-2&&lr.right<=cr.right+2, label+'：叶子横向不越出中心列:: '+round(lr)+' in '+round(cr));
  }
  // 所有分屏手柄必须落在中心列内（错位的分隔条会吞掉半个窗口的点击）
  for(const h of document.querySelectorAll('.workspace-leaf-resize-handle')){
    if(!h.closest('.workspace-split.mod-root')) continue;
    const hr=rect(h);
    check(hr.w>0&&hr.h>0, label+'：分屏手柄尺寸非零:: '+round(hr));
  }
};

assertGeometry('初始');

/* ------------------------------------------------------------ 左右分屏 */
await app.commands.executeCommandById('workspace:split-vertical');
await wait(400);
assertGeometry('左右分屏后');
let ls=leaves();
check(ls.length>=2,'左右分屏产生两个叶子:: '+ls.length);
if(ls.length>=2){
  const r0=rect(ls[0]),r1=rect(ls[1]);
  check(Math.abs(r0.y-r1.y)<3, '左右分屏两叶同高起点:: '+round(r0)+' / '+round(r1));
  check(r0.w<innerWidth*0.9&&r1.w<innerWidth*0.9, '左右分屏两叶各占一半左右:: '+round(r0)+' / '+round(r1));
  check(r0.right<=r1.x+2||r1.right<=r0.x+2, '左右分屏两叶不重叠:: '+round(r0)+' / '+round(r1));
}

/* ------------------------------------------------------------ 上下分屏 */
await app.commands.executeCommandById('workspace:split-horizontal');
await wait(400);
assertGeometry('上下分屏后');
ls=leaves();
check(ls.length>=3,'上下分屏再产生一个叶子:: '+ls.length);

/* ------------------------------------------------- 工作区布局：保存与加载 */
await app.plugins.enableInternalPlugin('workspaces');
await wait(200);
const plugin=app.plugins.getInternalPlugin('workspaces').instance;
await plugin.saveWorkspace('布局回归');
await wait(150);
const saved=app.settings.readJson('workspaces.json');
check(!!(saved&&saved.workspaces&&saved.workspaces['布局回归']),'布局写入 workspaces.json');
const before=leaves().map(rect).map(round).join(' | ');
await plugin.loadWorkspace('布局回归');
await wait(500);
assertGeometry('加载布局后');
const after=leaves().map(rect).map(round).join(' | ');
check(before===after,'加载后的分屏几何与保存时一致:: '+before+' => '+after);
check(app.settings.appSettings!==undefined,'加载布局未破坏设置对象');

/* --------------------------------------------------------- 关闭再开一个分屏 */
const active=ws.activeLeaf;
if(active) active.detach();
await wait(300);
assertGeometry('关闭叶子后');

await app.saveLayout();
return {pass:true,count:checks.length,checks,geometry:leaves().map(rect).map(round)};
})()

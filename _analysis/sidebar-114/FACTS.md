# 侧栏动画静态事实

事实源：_analysis/obsidian-114/renderer/app.js。下列字符偏移按 Python Unicode 码点计数。

- 字符偏移1546965的collapse先写collapsed，再锁住直接子容器minWidth为侧栏size。
- collapse临时设overflow:hidden，将width从size补间到0；结束隐藏容器并清子节点minWidth。
- 字符偏移1547875的expand先显示，使用同样的内容宽度锁，width从0补间到size。
- 状态保存和updateFrameless在动作时发起；不是等待其它侧栏动画完成。
- 字符偏移1548622侧栏拖动只改变该侧栏size；不能把中心文档写成固定像素宽。

实现诊断：原实现用workspace._sidebarAnim单句柄。右侧收起时点左侧会取消右动画而不执行收起回调；collapsed已true但display仍可见。缺内容宽度锁则让正文在缩小容器内重新换行。

本轮实现应让每个split拥有独立动画；同侧反向使用当前可见宽度；动画中重建DOM先结算旧动画，禁止迟到回调修改新容器。

收起活动侧栏的焦点：原版collapse码点1547735调用setActiveLeaf(getMostRecentLeaf(rootSplit),{focus:true})。getMostRecentLeaf码点2930925按可见性和activeTime选择。当前实现优先最近仍可见的中心叶，排除已关闭和过时布局节点，恢复真实焦点及编辑命令宿主。

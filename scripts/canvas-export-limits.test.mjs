/**
 * [INPUT]: Node assert、纯数值画布导出边界。
 * [OUTPUT]: {pass,count,checks}；验证尺寸与预算不分配真实位图。
 * [POS]: 导出内存预算单元测试，防止大图在拒绝前触发内存分配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { MAX_SIZE, MAX_EXPORT_MEMORY, canvasPixelRatio, estimateCanvasExportBytes, assertCanvasExportBudget } from '../src/renderer/views/canvas-export-limits.ts';
const checks = [];
function check(message, fn) { fn(); checks.push(message); }
check('长边与原版一致', () => assert.equal(MAX_SIZE, 16284));
check('预算为 512 MiB', () => assert.equal(MAX_EXPORT_MEMORY, 512 * 1024 * 1024));
check('Retina 密度与原版一致', () => assert.equal(canvasPixelRatio(2, 1), 2));
check('页面缩放不叠加设备密度', () => assert.equal(canvasPixelRatio(2.5, 1.25), 2));
check('密度按原版保留五位小数', () => assert.equal(canvasPixelRatio(4, 3), 1.33333));
check('非法密度不进入导出', () => assert.throws(() => canvasPixelRatio(0, 1), /像素密度/));
check('超 4096 的长条图通过预算', () => assert.ok(assertCanvasExportBudget({ width: 10000, height: 500 }) > 0));
check('原版最大长边的窄图通过预算', () => assert.ok(assertCanvasExportBudget({ width: 16284, height: 100 }) > 0));
check('不分配超过预算的大正方形', () => assert.throws(() => assertCanvasExportBudget({ width: 16284, height: 16284 }), /内存预算/));
check('超过原版长边明确拒绝', () => assert.throws(() => assertCanvasExportBudget({ width: 16285, height: 10 }), /16284/));
for (const value of [0, -1, NaN, Infinity, 1.5]) check('无效像素尺寸 ' + value, () => assert.throws(() => estimateCanvasExportBytes(value, 10), /尺寸无效/));
check('无效内存预算拒绝', () => assert.throws(() => assertCanvasExportBudget({ width: 10, height: 10 }, { memoryBudgetBytes: 0 }), /预算无效/));
check('自定义较小预算生效', () => assert.throws(() => assertCanvasExportBudget({ width: 100, height: 100 }, { memoryBudgetBytes: 1024 }), /内存预算/));
check('保守估计涵盖输出及分块', () => assert.equal(estimateCanvasExportBytes(100, 200), 100 * 200 * 28));
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));

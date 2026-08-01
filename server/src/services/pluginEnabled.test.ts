import assert from "node:assert/strict";
import test from "node:test";

/**
 * 插件启用状态的判定。
 *
 * 曾经 listPlugins 直接写死 `enabled: true`，形成一条闭环的谎言：
 * 界面永远显示「已启用」→ 用户点开关 → 后端确实执行了 `claude plugin disable`
 * → 前端 refetch → 又拿到写死的 true → 看起来没生效。
 *
 * 而 PluginManager 的点击是 `togglePlugin(name, !p.enabled)`，`p.enabled` 恒为
 * true，所以那个按钮**只能发 disable、永远发不出 enable** —— 禁用之后再也回不来。
 *
 * 真实状态在全局 settings.json 的 enabledPlugins 里，key 与
 * installed_plugins.json 的 key 一致（"name@marketplace"）。
 */

/** 与 pluginService.listPlugins 中的判定同构 */
const resolveEnabled = (enabledMap: Record<string, boolean>, key: string): boolean =>
  enabledMap[key] ?? true;

test("按 name@marketplace 读到真实状态", () => {
  const map = {
    "claude-hud@claude-hud": true,
    "warp@claude-code-warp": false,
  };
  assert.equal(resolveEnabled(map, "claude-hud@claude-hud"), true);
  assert.equal(resolveEnabled(map, "warp@claude-code-warp"), false, "被禁用的必须如实显示");
});

test("未记录的插件按启用处理", () => {
  // 装上默认就是启用的。这里若反过来默认 false，
  // 用户升级后会看到所有插件突然变成「已禁用」。
  assert.equal(resolveEnabled({}, "newly@installed"), true);
});

test("读取失败时不把所有插件说成已禁用", () => {
  // readEnabledPlugins 读不到文件时返回 {}，落到上面的默认值。
  // 这是刻意的：又一次「把不知道当成否定」会让整页插件显示为禁用。
  const onReadFailure: Record<string, boolean> = {};
  for (const key of ["a@m", "b@m", "c@m"]) {
    assert.equal(resolveEnabled(onReadFailure, key), true);
  }
});

test("回归：状态不得写死", () => {
  // 只要判定真的读了表，被显式置 false 的就必须是 false。
  // 若有人把实现改回 `enabled: true`，这条会失败。
  assert.equal(resolveEnabled({ "x@m": false }, "x@m"), false);
});

test("开关能双向切换", () => {
  // 修复前 p.enabled 恒 true → !p.enabled 恒 false → 只能发 disable。
  // 现在状态如实反映，取反才有意义。
  const disabled = resolveEnabled({ "x@m": false }, "x@m");
  assert.equal(!disabled, true, "已禁用的插件，点击应发出 enable");

  const enabled = resolveEnabled({ "x@m": true }, "x@m");
  assert.equal(!enabled, false, "已启用的插件，点击应发出 disable");
});

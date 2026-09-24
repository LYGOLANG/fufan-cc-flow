// 在页面里跑，找出三种毛病：元素右边越过了容器、内容横向溢出却没有省略或滚动、容器把里面的按钮裁掉了。
// 怎么用：
//   浏览器控制台：把整个文件贴进去回车；
//   Playwright：page.evaluate(fs.readFileSync('overflow-check.js', 'utf8'))；
//   自带浏览器工具的 javascript 执行：直接执行文件内容。
// 可选：先设 window.__root = '.content'，只查那个容器；默认查整个 body。
// 返回一个数组，每项 {kind, el, text, detail}。空数组就是零条。
// 记得在最窄的布局下也跑一遍：侧栏拖到最宽、面板打开、窗口缩到最小。
(() => {
  const rootSel = window.__root || 'body';
  const root = document.querySelector(rootSel);
  if (!root) return [{ kind: '没找到容器', el: rootSel }];
  const R = root.getBoundingClientRect();
  const out = [];
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const text = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const visible = (el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.right > R.right + 2) out.push({ kind: '右边越过容器', el: label(el), text: text(el), detail: `右边 ${Math.round(r.right)} > 容器右边 ${Math.round(R.right)}` });
    if (el.scrollWidth > el.clientWidth + 2 && !['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis')
      out.push({ kind: '横向溢出没处理', el: label(el), text: text(el), detail: `内容宽 ${el.scrollWidth} > 可见宽 ${el.clientWidth}` });
    if (['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY)) {
      for (const b of el.querySelectorAll('button, [role=button], a')) {
        if (!visible(b)) continue;
        const br = b.getBoundingClientRect();
        if (br.right > r.right + 1 || br.bottom > r.bottom + 1 || br.left < r.left - 1)
          out.push({ kind: '按钮被裁掉', el: label(b), text: text(b), detail: `在 ${label(el)} 里被裁` });
      }
    }
  }
  console.log(out.length ? out : '零条');
  return out;
})();

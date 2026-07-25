/**
 * 共享的语法高亮器(按需注册版)。
 *
 * 此前 MarkdownRenderer / CodeViewer 直接 `import { Prism }`(全量版)——它静态
 * 打包 Prism 的全部语言定义,是主 bundle 1.8MB 的最大单一来源。改用 PrismLight
 * 只注册实际会遇到的语言,主 chunk 立减数百 KB;未注册语言自动按纯文本渲染,
 * 不报错不白屏。新增语言支持:在下方 register 清单加一行即可。
 */
import { PrismLight } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";

const REGISTRY: Record<string, unknown> = {
  tsx,
  typescript,
  ts: typescript,
  javascript,
  js: javascript,
  jsx,
  json,
  bash,
  sh: bash,
  shell: bash,
  python,
  py: python,
  rust,
  go,
  css,
  markup,
  html: markup,
  xml: markup,
  markdown,
  md: markdown,
  yaml,
  yml: yaml,
  sql,
  diff,
  toml,
  docker,
  dockerfile: docker,
  java,
  c,
  cpp,
};

for (const [name, lang] of Object.entries(REGISTRY)) {
  PrismLight.registerLanguage(name, lang);
}

export { PrismLight as SyntaxHighlighter, oneDark };

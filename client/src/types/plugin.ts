/**
 * 待安装的插件（随包内置的，或用户从本地文件夹挑的）。
 *
 * 与 PluginInfo 分开：那个描述的是**已装进 Claude Code** 的插件（有 scope、
 * marketplace、installPath、启用开关），这个描述的是「装之前长什么样」，
 * 只有 installed 一个状态位。混用会逼出一堆恒为 undefined 的字段。
 */
export interface BundledPluginInfo {
  /** 目录名，安装 API 的入参 */
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
  installed: boolean;
  components: {
    skills: string[];
    agents: string[];
    hooks: boolean;
  };
}

export interface PluginInfo {
  name: string;
  version?: string;
  author?: string;
  description?: string;
  enabled: boolean;
  scope?: string;
  marketplace?: string;
  installPath?: string;
  gitCommitSha?: string;
  installedAt?: string;
  components?: {
    skills?: string[];
    mcpServers?: string[];
    agents?: string[];
    hooks?: string[];
  };
}

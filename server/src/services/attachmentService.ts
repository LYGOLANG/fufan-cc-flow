import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  serverPath: string;
}

/**
 * 附件目录。projectPath 来自请求参数，必须当不可信输入处理。
 *
 * 这条曾是全项目**唯一**没有路径守卫的写路径：`?project=` 传任意字符串
 * 就能在任意位置 mkdir 出 `.claude/attachments` 并写进 10MB 文件。
 * 对照 routes/files.ts 的 resolveWriteTarget —— 那边 projectRoot 必填、
 * 且强制 assertWithinRoot，这边什么都没有。
 *
 * 要求绝对路径：相对路径会落到后端进程的 cwd（桌面版是安装目录），
 * 那既不是用户预期的位置，也绕开了「写在项目内」这个约束。
 *
 * **这个守卫不能做什么**（写明白，免得下一个人以为它挡住了路径穿越）：
 * 这里 projectPath 既是根又是目标，"不越出根"是恒真的 —— 传
 * `C:\proj\..\..\Windows` 归一化后就是 `C:\Windows`，一个合法的绝对路径，
 * 检查必然通过。真正阻止「往任意位置写」的是接口鉴权
 * （middleware/auth.ts，本机其它进程调不动这个接口），不是这里。
 */
function getAttachmentsDir(projectPath: string): string {
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("project 不能为空");
  }
  if (!path.isAbsolute(projectPath)) {
    throw new Error("project 必须是绝对路径");
  }
  // 归一后再拼，挡住 "C:\proj\..\..\Windows" 这类先合法后跳出的写法
  const root = path.resolve(projectPath);
  const dir = path.join(root, ".claude", "attachments");
  if (!dir.startsWith(root)) {
    throw new Error("附件目录越出项目范围");
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveFile(
  file: Express.Multer.File,
  projectPath: string,
  originalName?: string
): AttachmentMeta {
  const id = crypto.randomUUID();
  const displayName = originalName || file.originalname;
  const ext = path.extname(displayName) || path.extname(file.originalname) || "";
  const filename = `${id}${ext}`;
  const dir = getAttachmentsDir(projectPath);
  const destPath = path.join(dir, filename);

  fs.writeFileSync(destPath, file.buffer);

  // Return relative path (relative to projectPath / spawn cwd).
  // UUID filenames contain no spaces, so the path survives cmd.exe quoting.
  const relPath = `.claude/attachments/${filename}`;

  return {
    id,
    name: displayName,
    type: file.mimetype,
    size: file.size,
    serverPath: relPath,
  };
}

export function deleteFile(id: string, projectPath: string): void {
  // 空串或含路径分隔符的 id 一律拒绝。
  //
  // 下面用的是 startsWith(id)：空串会匹配到目录里**第一个**文件并把它删掉 ——
  // 删的是别人的附件，而调用方只是传了个反推失败的空 id。
  // 这个函数唯一的输入来自「从路径反推文件名」，那是最容易出错的一环，
  // 不能把「删哪个文件」完全托付给它传对。
  if (!id || /[\\/]/.test(id) || id.includes("..")) return;

  const dir = getAttachmentsDir(projectPath);
  // Find file starting with the id
  const files = fs.readdirSync(dir);
  // 加 "." 界定：id 是去掉扩展名的 uuid，真实文件必然是 `<id>.<ext>`。
  // 不加的话 "abc" 会误命中 "abcdef.png"。
  const target = files.find((f) => f.startsWith(`${id}.`));
  if (target) {
    fs.unlinkSync(path.join(dir, target));
  }
}

export function cleanupFiles(ids: string[], projectPath: string): void {
  for (const id of ids) {
    try {
      deleteFile(id, projectPath);
    } catch {
      // best-effort cleanup
    }
  }
}

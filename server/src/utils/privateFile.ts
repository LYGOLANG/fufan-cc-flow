import { promises as fs } from "fs";
import path from "path";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/** Write sensitive local configuration and tighten existing POSIX permissions. */
export async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (process.platform !== "win32") await fs.chmod(directory, PRIVATE_DIR_MODE);

  await fs.writeFile(filePath, contents, {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  if (process.platform !== "win32") await fs.chmod(filePath, PRIVATE_FILE_MODE);
}

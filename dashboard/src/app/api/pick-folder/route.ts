import { NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * POST /api/pick-folder
 *
 * Opens native macOS folder picker dialog via osascript.
 * Returns selected folder path or null if cancelled.
 */
export async function POST() {
  try {
    // Use osascript to open native folder picker
    const script = `
      set chosenFolder to choose folder with prompt "Выберите папку проекта"
      return POSIX path of chosenFolder
    `;

    const result = execSync(`osascript -e '${script}'`, {
      encoding: "utf-8",
      timeout: 120000, // 2 min for user to pick
    }).trim();

    // Remove trailing slash if present
    const folderPath = result.endsWith("/") ? result.slice(0, -1) : result;

    return NextResponse.json({ path: folderPath });
  } catch {
    // User cancelled or osascript failed
    return NextResponse.json({ path: null });
  }
}

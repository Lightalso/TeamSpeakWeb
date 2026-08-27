const os = require("node:os");

// Some Node.js 25 Windows builds can throw ERR_SYSTEM_ERROR/ENOMEM from
// os.userInfo(), which Capacitor's terminal helper calls during startup. Keep
// normal behaviour everywhere else and provide only the fields that helper
// needs when the operating-system call itself is unavailable.
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: process.env.USERNAME || "user",
    homedir: process.cwd(),
    shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
  });
}

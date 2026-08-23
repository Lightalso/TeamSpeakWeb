// Postinstall helper for @discordjs/opus.
//
// @discordjs/opus ships prebuilt binaries keyed by exact glibc/musl version.
// On systems with a *newer* libc than any published prebuild (e.g. glibc 2.43
// when only 2.35 is published), node-pre-gyp finds no match and falls back to a
// slow source build. This script instead downloads the closest compatible
// prebuild (glibc is backwards-compatible) and places it where the loader
// expects it.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) =>
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    get(url);
  });
}

function main() {
  let versioning, napi, pkg;
  try {
    const opusPkgPath = require.resolve('@discordjs/opus/package.json');
    pkg = require(opusPkgPath);
    const moduleRoot = path.dirname(opusPkgPath);
    versioning = require('@discordjs/node-pre-gyp/lib/util/versioning.js');
    napi = require('@discordjs/node-pre-gyp/lib/util/napi.js');
    const opts = { module_root: moduleRoot };
    let napiBuildVersion;
    if (napi.get_napi_build_versions(pkg, opts)) {
      napiBuildVersion = napi.get_best_napi_build_version(pkg, opts);
    }
    opts.versioning = versioning.evaluate(pkg, opts, napiBuildVersion);
    versioning = opts.versioning;
  } catch (err) {
    console.warn('[install-opus] @discordjs/opus not installed, skipping:', err.message);
    return;
  }

  const moduleFile = versioning.module;
  if (fs.existsSync(moduleFile)) {
    console.log('[install-opus] opus binary already present');
    return;
  }

  const candidates = [versioning.libc_version];
  if (versioning.libc === 'glibc') candidates.push('2.39', '2.35', '2.31');
  if (versioning.libc === 'musl') candidates.push('1.2.5', '1.2.4', '1.2.2');
  const seen = new Set();
  const versions = candidates.filter((v) => {
    if (!v || seen.has(v)) return false;
    seen.add(v);
    return true;
  });

  const downloadAndInstall = (ver) =>
    new Promise((resolve, reject) => {
      const tarball = versioning.hosted_tarball.replace(versioning.libc_version, ver);
      const tmp = path.join(moduleRoot, 'build', `opus-${ver}.tar.gz`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      download(tarball, tmp)
        .then(() => {
          fs.mkdirSync(versioning.module_path, { recursive: true });
          execFileSync('tar', ['-xzf', tmp, '-C', versioning.module_path, '--strip-components=1']);
          fs.rmSync(tmp, { force: true });
          if (fs.existsSync(moduleFile)) {
            console.log(`[install-opus] installed prebuild (libc ${ver})`);
            resolve();
          } else {
            reject(new Error('extract did not produce opus.node'));
          }
        })
        .catch(reject);
    });

  const tryAll = async () => {
    let lastErr;
    for (const ver of versions) {
      try {
        await downloadAndInstall(ver);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn('[install-opus] no prebuild matched; voice will be disabled.');
    console.warn('[install-opus] install build tools and run `npm rebuild @discordjs/opus` to build from source.');
    if (lastErr) console.warn('[install-opus] last error:', lastErr.message);
  };

  tryAll().catch(() => {});
}

main();

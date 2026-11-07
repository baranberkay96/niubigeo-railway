#!/usr/bin/env node
// NiubiGEO on Railway: runs the workbench server and the scheduling worker in one container.
//
// Upstream runs them as two containers that share one data directory. A Railway volume belongs
// to exactly one service, so both processes live in this service. This script:
//   1. validates the settings and checks that the data directory is writable,
//   2. saves a copy of the product data before a different NiubiGEO version first opens it,
//   3. starts the server; if it stops, the container stops and Railway restarts it,
//   4. starts the worker and restarts it with backoff if it stops (the workbench stays up),
//   5. forwards SIGTERM so a running monitoring cycle can finish within the draining window.
// It uses only Node's standard library and the image's busybox tar.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TAG = "[niubigeo-railway]";
const SERVER_SCRIPT = "dist/src/product/product-server.js";
const WORKER_SCRIPT = "dist/src/product/scheduling/schedule-worker.js";
const SNAPSHOT_PATTERN = /^product-v2-before-.+\.tar\.gz$/;
const WORKER_BASE_DELAY_S = 5;
const WORKER_MAX_DELAY_S = 300;
const WORKER_STABLE_MS = 10 * 60 * 1000;

const log = (message) => console.log(`${TAG} ${message}`);
const warn = (message) => console.error(`${TAG} WARNING: ${message}`);

export function parseBoolean(name, value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false, got "${value}".`);
}

export function parseInteger(name, value, fallback, min, max) {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be a whole number, got "${value}".`);
  const parsed = Number(value.trim());
  if (parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}, got ${parsed}.`);
  return parsed;
}

function absolutePath(name, value) {
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path, got "${value}".`);
  const normalized = path.normalize(value).replace(/\/+$/, "");
  if (normalized === "") throw new Error(`${name} must not be the filesystem root.`);
  return normalized;
}

export function readConfig(env) {
  const appDir = absolutePath("NIUBIGEO_APP_DIR", env.NIUBIGEO_APP_DIR || "/app");
  const dataRoot = absolutePath("MONITORING_DATA_DIR", env.MONITORING_DATA_DIR || path.join(appDir, "data"));
  const productDir = absolutePath("PRODUCT_DATA_DIR", env.PRODUCT_DATA_DIR || path.join(dataRoot, "product-v2"));
  const drainSeconds = parseInteger("RAILWAY_DEPLOYMENT_DRAINING_SECONDS", env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS, 0, 0, 3600);
  return Object.freeze({
    appDir,
    dataRoot,
    productDir,
    workerEnabled: parseBoolean("NIUBIGEO_WORKER_ENABLED", env.NIUBIGEO_WORKER_ENABLED, true),
    pollSeconds: parseInteger("NIUBIGEO_WORKER_POLL_SECONDS", env.NIUBIGEO_WORKER_POLL_SECONDS, 60, 10, 86400),
    snapshotKeep: parseInteger("NIUBIGEO_SNAPSHOT_KEEP", env.NIUBIGEO_SNAPSHOT_KEEP, 3, 0, 50),
    stopGraceMs: Math.min(Math.max(drainSeconds - 5, 5), 600) * 1000,
    serverKeySet: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"].some(
      (name) => Boolean((env[name] || "").trim() || (env[`${name}_FILE`] || "").trim()),
    ),
  });
}

export function readAppVersion(appDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^[0-9A-Za-z.+-]{1,64}$/.test(manifest.version)) {
    throw new Error(`Cannot read NiubiGEO's version from ${appDir}/package.json.`);
  }
  return manifest.version;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isMountPoint(dir) {
  return fs.statSync(dir).dev !== fs.statSync(path.dirname(dir)).dev;
}

export function prepareDataDir(config) {
  fs.mkdirSync(config.productDir, { recursive: true });
  if (!isMountPoint(config.dataRoot)) {
    warn(`${config.dataRoot} is not a separate volume. Projects and evidence will be lost on the next redeploy; attach a Railway volume at ${config.dataRoot}.`);
  }
  if (!isInside(config.productDir, config.dataRoot)) {
    warn(`PRODUCT_DATA_DIR (${config.productDir}) is outside ${config.dataRoot}; only ${config.dataRoot} is on the volume.`);
  }
  const probe = path.join(config.productDir, `.railway-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch (error) {
    throw new Error(`Cannot write to ${config.productDir}: ${error.message}`);
  }
}

const safeName = (value) => value.replace(/[^0-9A-Za-z.-]/g, "_");
const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function atomicWrite(file, content) {
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, content);
  fs.renameSync(partial, file);
}

function pruneSnapshots(dir, keep) {
  const entries = fs.readdirSync(dir);
  for (const name of entries.filter((entry) => entry.endsWith(".tar.gz.partial"))) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
  const snapshots = entries
    .filter((name) => SNAPSHOT_PATTERN.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  for (const old of snapshots.slice(keep)) {
    fs.rmSync(path.join(dir, old.name), { force: true });
    log(`removed old snapshot ${old.name} (NIUBIGEO_SNAPSHOT_KEEP=${keep})`);
  }
}

function writeSnapshot(config, previous, version, now) {
  const dir = path.join(config.dataRoot, "backups");
  fs.mkdirSync(dir, { recursive: true });
  pruneSnapshots(dir, Number.MAX_SAFE_INTEGER);
  const file = path.join(dir, `product-v2-before-${safeName(version)}-from-${safeName(previous)}-${stamp(now)}.tar.gz`);
  const partial = `${file}.partial`;
  log(`NiubiGEO ${previous} -> ${version}: saving ${config.productDir} to ${file} before the new version opens it.`);
  const args = ["-czf", partial, "-C", path.dirname(config.productDir), path.basename(config.productDir)];
  const result = spawnSync("tar", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (result.error || result.status !== 0) {
    fs.rmSync(partial, { force: true });
    const reason = result.error ? result.error.message : `tar exited with ${result.status}`;
    throw new Error(`Snapshot failed (${reason}). Free space on the volume, or set NIUBIGEO_SNAPSHOT_KEEP=0 to start without one.`);
  }
  fs.renameSync(partial, file);
  return file;
}

export function snapshotIfVersionChanged(config, version, now = new Date()) {
  const markerDir = path.join(config.dataRoot, ".railway-template");
  const marker = path.join(markerDir, "niubigeo-version");
  const previous = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const hasData = fs.existsSync(config.productDir) && fs.readdirSync(config.productDir).length > 0;
  let snapshot = null;
  if (previous && previous !== version && config.snapshotKeep > 0 && hasData) {
    snapshot = writeSnapshot(config, previous, version, now);
    pruneSnapshots(path.dirname(snapshot), config.snapshotKeep);
  }
  fs.mkdirSync(markerDir, { recursive: true });
  atomicWrite(marker, `${version}\n`);
  return { previous: previous || null, snapshot };
}

const describeExit = (code, signal) => (signal ? `signal ${signal}` : `code ${code}`);
const isRunning = (child) => child !== null && child.exitCode === null && child.signalCode === null;

function startProcess(name, args, config) {
  const child = spawn(process.execPath, args, { cwd: config.appDir, env: process.env, stdio: "inherit" });
  child.on("error", (error) => warn(`${name} could not be started: ${error.message}`));
  log(`${name} started (pid ${child.pid})`);
  return child;
}

// Stops every running child with SIGTERM, waits up to stopGraceMs, then SIGKILLs the rest.
function createShutdown(state, config) {
  return (exitCode) => {
    if (state.stopping) return;
    state.stopping = true;
    if (state.workerTimer) clearTimeout(state.workerTimer);
    const running = [state.server, state.worker].filter(isRunning);
    if (running.length === 0) process.exit(exitCode);
    for (const child of running) child.kill("SIGTERM");
    const deadline = setTimeout(() => {
      for (const child of running.filter(isRunning)) child.kill("SIGKILL");
      warn("processes did not stop in time and were killed.");
      process.exit(exitCode);
    }, config.stopGraceMs);
    let pending = running.length;
    for (const child of running) {
      child.once("exit", () => {
        pending -= 1;
        if (pending > 0) return;
        clearTimeout(deadline);
        process.exit(exitCode);
      });
    }
  };
}

// The worker is restarted with exponential backoff; a run of 10+ minutes resets the backoff.
function createWorkerStarter(state, config) {
  const startWorker = () => {
    state.workerTimer = null;
    if (state.stopping) return;
    const startedAt = Date.now();
    const worker = startProcess("worker", [WORKER_SCRIPT, String(config.pollSeconds)], config);
    state.worker = worker;
    worker.on("exit", (code, signal) => {
      state.worker = null;
      if (state.stopping) return;
      state.workerFailures = Date.now() - startedAt >= WORKER_STABLE_MS ? 1 : state.workerFailures + 1;
      const delay = Math.min(WORKER_MAX_DELAY_S, WORKER_BASE_DELAY_S * 2 ** (state.workerFailures - 1));
      warn(`worker exited (${describeExit(code, signal)}); restarting it in ${delay} s. The workbench keeps running.`);
      state.workerTimer = setTimeout(startWorker, delay * 1000);
    });
  };
  return startWorker;
}

export function supervise(config) {
  const state = { stopping: false, server: null, worker: null, workerTimer: null, workerFailures: 0 };
  const shutdown = createShutdown(state, config);
  state.server = startProcess("server", [SERVER_SCRIPT], config);
  state.server.on("error", () => shutdown(1));
  state.server.on("exit", (code, signal) => {
    if (state.stopping) return;
    warn(`server exited (${describeExit(code, signal)}); stopping the container so Railway restarts it.`);
    shutdown(code ? code : 1);
  });

  if (config.workerEnabled) createWorkerStarter(state, config)();
  else log("worker disabled (NIUBIGEO_WORKER_ENABLED=false): schedules and keyword monitors will not run.");

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      log(`${signal} received; stopping (up to ${config.stopGraceMs / 1000} s for a running cycle to finish).`);
      shutdown(0);
    });
  }
}

function selfTest() {
  const config = readConfig(process.env);
  for (const script of [SERVER_SCRIPT, WORKER_SCRIPT]) {
    if (!fs.existsSync(path.join(config.appDir, script))) throw new Error(`missing ${config.appDir}/${script}`);
  }
  const version = readAppVersion(config.appDir);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "niubigeo-self-test-"));
  try {
    const probe = readConfig({ NIUBIGEO_APP_DIR: config.appDir, MONITORING_DATA_DIR: scratch, NIUBIGEO_SNAPSHOT_KEEP: "1" });
    fs.mkdirSync(probe.productDir, { recursive: true });
    fs.writeFileSync(path.join(probe.productDir, "probe.json"), "{}");
    snapshotIfVersionChanged(probe, "0.0.0-self-test");
    const { snapshot } = snapshotIfVersionChanged(probe, version);
    const listing = spawnSync("tar", ["-tzf", snapshot], { encoding: "utf8" });
    if (listing.status !== 0 || !listing.stdout.includes("product-v2/probe.json")) throw new Error("snapshot round trip failed");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  log(`self-test passed: NiubiGEO ${version}, Node ${process.version}, tar snapshot round trip ok.`);
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const config = readConfig(process.env);
  const version = readAppVersion(config.appDir);
  log(`NiubiGEO ${version}; data in ${config.productDir}; worker ${config.workerEnabled ? `on, every ${config.pollSeconds} s` : "off"}; OpenRouter server key ${config.serverKeySet ? "set" : "not set (scheduled runs need OPENROUTER_API_KEY)"}.`);
  prepareDataDir(config);
  const { previous, snapshot } = snapshotIfVersionChanged(config, version);
  if (snapshot) log(`snapshot saved: ${snapshot}`);
  else if (previous && previous !== version) log(`version changed from ${previous}; no snapshot (no data yet or NIUBIGEO_SNAPSHOT_KEEP=0).`);
  supervise(config);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`${TAG} ERROR: ${error.message}`);
    process.exit(1);
  }
}

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Pi's interactive UI is bundled locally. Keep the small MoAH-specific UI edits
// here so an upstream bundle refresh fails loudly if its relevant code changes.
const runtimePath = join("src", "vendor", "pi-runtime", "chunks", "chunk-JVUZSMYM.js");
let runtime = await readFile(runtimePath, "utf8");

function replaceOnce(original, branded, label) {
  const sourceMatches = runtime.split(original).length - 1;
  const brandedMatches = runtime.split(branded).length - 1;
  if (sourceMatches === 1 && brandedMatches === 0) {
    runtime = runtime.replace(original, branded);
    return;
  }
  if (sourceMatches === 0 && brandedMatches === 1) return;
  throw new Error(`MoAH runtime UI patch drifted: ${label} (source=${sourceMatches}, branded=${brandedMatches})`);
}

replaceOnce(
  '"Pi can explain its own features and look up its docs. Ask it how to use or extend Pi."',
  '"MoAH keeps optional tools ready and activates the ones each request needs. Use /moah for status and /about for credits."',
  "onboarding",
);
replaceOnce(
  'extensionCompactList=formatCompactList(this.getCompactExtensionLabels(extensions))',
  'extensionCompactList=theme.fg("dim",`  ${extensions.length} loaded · ${keyText("app.tools.expand")} to inspect`)',
  "collapsed extension inventory",
);
replaceOnce(
  'customThemes=themesResult.themes.filter(t=>t.sourcePath)',
  'customThemes=themesResult.themes.filter(t=>t.sourcePath&&t.name!=="moah")',
  "hide built-in MoAH theme from resource inventory",
);
replaceOnce(
  'checkForNewPiVersion(this.version).then(newRelease=>{newRelease&&this.showNewVersionNotification(newRelease)})',
  'Promise.resolve(void 0/* MoAH: upstream release check disabled */)',
  "Pi release notification",
);
replaceOnce(
  'this.checkForPackageUpdates().then(updates=>{updates.length>0&&this.showPackageUpdateNotification(updates)})',
  'Promise.resolve(void 0/* MoAH: upstream package update notice disabled */)',
  "Pi package update notification",
);
replaceOnce(
  'reportInstallTelemetry(version){process.env.PI_OFFLINE||isInstallTelemetryEnabled(this.settingsManager)&&fetch(`https://pi.dev/api/report-install?version=${encodeURIComponent(version)}`,{headers:{"User-Agent":getPiUserAgent(version)},signal:AbortSignal.timeout(5e3)}).then(()=>{}).catch(()=>{})}',
  'reportInstallTelemetry(_version){/* MoAH: no Pi install telemetry */}',
  "Pi install telemetry",
);
replaceOnce(
  'getChangelogForDisplay(){if(this.session.state.messages.length>0)return;',
  'getChangelogForDisplay(){if(true/* MoAH owns its release notes */)return;',
  "Pi changelog on MoAH startup",
);

await writeFile(runtimePath, runtime);
console.log("MoAH terminal branding verified.");

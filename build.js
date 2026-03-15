const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const { version } = require("./package.json");

const MAIN_JS_PATH = path.resolve(__dirname, "./dist/main.js");
const RELEASE_DIR = path.resolve(__dirname, "./release");
const PLUGIN_NAME = `bob-plugin-le-dictionnaire@${version}.bobplugin`;
const ARTIFACT_PATH = path.resolve(RELEASE_DIR, PLUGIN_NAME);

const INFO_JSON = {
  identifier: "com.ledictionnaire.bob.dictionary",
  version: version,
  category: "translate",
  name: "Le-Dictionnaire Dictionary",
  author: "larousse_bob",
  summary: "French dictionary via le-dictionnaire.com",
  homepage: "https://github.com/callmeeric5/bob-plugin-frdict",
  minBobVersion: "1.8.0",
  options: [],
  icon: "icon",
  appcast: "https://raw.githubusercontent.com/callmeeric5/bob-plugin-frdict/main/appcast.json"
};

const ensureReleaseDir = () => {
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }
};

const createZip = () => {
  ensureReleaseDir();
  const zip = new AdmZip();
  zip.addLocalFile(MAIN_JS_PATH);
  const iconPath = path.resolve(__dirname, "./static/icon.png");
  if (fs.existsSync(iconPath)) {
    zip.addLocalFile(iconPath);
  }
  zip.addFile("info.json", Buffer.from(JSON.stringify(INFO_JSON, null, 2)));
  zip.writeZip(ARTIFACT_PATH);
  console.log(new Date(), "Zip created", ARTIFACT_PATH);
};

const initAppcast = () => {
  ensureReleaseDir();
  const fileBuffer = fs.readFileSync(ARTIFACT_PATH);
  const sha = crypto.createHash("sha256");
  sha.update(fileBuffer);
  const hex = sha.digest("hex");
  const currentVersionInfo = {
    version: version,
    desc: "See GitHub Releases for details.",
    sha256: hex,
    url: `https://github.com/callmeeric5/bob-plugin-frdict/releases/download/v${version}/${PLUGIN_NAME}`,
    minBobVersion: INFO_JSON.minBobVersion,
    timestamp: Date.now()
  };

  const appcastPath = path.resolve(__dirname, "./appcast.json");
  if (!fs.existsSync(appcastPath)) {
    fs.writeFileSync(appcastPath, JSON.stringify({ versions: [] }, null, 2), {
      encoding: "utf-8"
    });
  }
  const appcast = JSON.parse(fs.readFileSync(appcastPath, "utf-8"));
  if (!appcast.versions.find((item) => item.version === currentVersionInfo.version)) {
    appcast.versions.unshift(currentVersionInfo);
    fs.writeFileSync(appcastPath, JSON.stringify(appcast, null, 2), {
      encoding: "utf-8"
    });
  }
};

require("esbuild")
  .build({
    entryPoints: ["./src/entry.ts"],
    bundle: true,
    platform: "node",
    treeShaking: false,
    outfile: MAIN_JS_PATH
  })
  .then(() => {
    createZip();
    initAppcast();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
